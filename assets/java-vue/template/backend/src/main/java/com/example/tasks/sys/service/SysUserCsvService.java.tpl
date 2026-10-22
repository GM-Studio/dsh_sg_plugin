package com.example.tasks.sys.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.sys.entity.SysUser;
import com.example.tasks.sys.repository.SysUserRepository;
import com.example.tasks.vo.ImportResult;
import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 用户 CSV 导入导出服务：UTF-8 编码，限制文件大小与行数，导入先整体校验、后落库。 */
@Service
public class SysUserCsvService {
    /** 固定表头，顺序即列顺序，导入时严格比对。 */
    private static final List<String> HEADER =
            Arrays.asList("username", "displayName", "roleCode", "enabled");

    private final SysUserRepository repository;
    private final SysUserService users;
    private final int maxRows;
    private final long maxBytes;

    public SysUserCsvService(
            SysUserRepository repository,
            SysUserService users,
            @Value("${app.csv.max-rows}") int maxRows,
            @Value("${app.csv.max-bytes}") long maxBytes) {
        this.repository = repository;
        this.users = users;
        this.maxRows = maxRows;
        this.maxBytes = maxBytes;
    }

    /** 解析并校验 CSV：commit=false 仅返回校验结果，commit=true 时全部通过才落库（同一事务）。 */
    @Transactional
    public ImportResult ingest(MultipartFile file, boolean commit) {
        if (file.isEmpty() || file.getSize() > maxBytes) {
            throw new BusinessException(
                    400, "CSV_SIZE", "CSV is empty or exceeds the configured limit");
        }
        List<SysUser> pending = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        try {
            String text = decode(file.getBytes());
            if (text.startsWith("\uFEFF")) {
                text = text.substring(1);
            }
            CSVFormat format =
                    CSVFormat.DEFAULT
                            .builder()
                            .setHeader()
                            .setSkipHeaderRecord(true)
                            .setIgnoreEmptyLines(true)
                            .build();
            try (CSVParser parser = format.parse(new StringReader(text))) {
                if (!parser.getHeaderNames().equals(HEADER)) {
                    throw new BusinessException(
                            400,
                            "CSV_HEADER",
                            "Expected username,displayName,roleCode,enabled header");
                }
                int rows = 0;
                for (CSVRecord record : parser) {
                    if (++rows > maxRows) {
                        throw new BusinessException(400, "CSV_ROWS", "CSV exceeds row limit");
                    }
                    long line = record.getRecordNumber() + 1;
                    String username = record.size() > 0 ? record.get(0).trim() : "";
                    String displayName = record.size() > 1 ? record.get(1).trim() : "";
                    String roleCode = record.size() > 2 ? record.get(2).trim() : "";
                    String enabled = record.size() > 3 ? record.get(3).trim() : "";
                    if (record.size() != 4
                            || username.isEmpty()
                            || username.length() > 64
                            || displayName.length() > 128
                            || roleCode.isEmpty()
                            || roleCode.length() > 64
                            || !("true".equals(enabled) || "false".equals(enabled))) {
                        errors.add(
                                "Row "
                                        + line
                                        + ": username and roleCode must contain 1–64 characters; displayName at most 128 characters; enabled must be true or false; exactly four columns required");
                    } else if (!seen.add(username)
                            || repository.findByUsername(username).isPresent()) {
                        errors.add("Row " + line + ": username already exists");
                    } else {
                        pending.add(
                                new SysUser(
                                        username,
                                        displayName.isEmpty() ? null : displayName,
                                        roleCode,
                                        Boolean.parseBoolean(enabled)));
                    }
                }
                if (rows == 0) {
                    errors.add("Row 2: at least one data row is required");
                }
            }
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException
                | IllegalStateException
                | IllegalArgumentException
                | java.io.UncheckedIOException exception) {
            throw new BusinessException(400, "CSV_FORMAT", "Malformed UTF-8 CSV");
        }
        if (commit && !errors.isEmpty()) {
            throw new BusinessException(400, "CSV_VALIDATION", String.join("; ", errors));
        }
        if (commit) {
            repository.saveAll(pending);
        }
        return new ImportResult(pending.size(), errors);
    }

    /** 按 username/roleCode/enabled 过滤导出用户，结果超过行数上限时要求先收窄条件。 */
    @Transactional(readOnly = true)
    public byte[] export(String username, String roleCode, Boolean enabled) {
        org.springframework.data.domain.Page<SysUser> page =
                repository.findAll(
                        users.filter(username, roleCode, enabled),
                        PageRequest.of(0, maxRows, org.springframework.data.domain.Sort.by("id")));
        if (page.getTotalElements() > maxRows) {
            throw new BusinessException(400, "EXPORT_ROWS", "Narrow the filter before exporting");
        }
        try {
            StringWriter writer = new StringWriter();
            writer.write('\uFEFF');
            try (CSVPrinter printer = new CSVPrinter(writer, CSVFormat.DEFAULT)) {
                printer.printRecord("username", "displayName", "roleCode", "enabled");
                for (SysUser user : page.getContent()) {
                    printer.printRecord(
                            safeCell(user.getUsername()),
                            safeCell(user.getDisplayName()),
                            safeCell(user.getRoleCode()),
                            user.isEnabled());
                }
            }
            return writer.toString().getBytes(StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new BusinessException(500, "EXPORT_FAILED", "Unable to export CSV");
        }
    }

    /** 导入模板：仅含表头与一行示例数据，便于用户直接填写。 */
    public byte[] template() {
        return ("username,displayName,roleCode,enabled\r\n"
                        + "Example,Example User,viewer,true\r\n")
                .getBytes(StandardCharsets.UTF_8);
    }

    /** 转义可能被表格软件当作公式执行的单元格，displayName 允许为空。 */
    static String safeCell(String value) {
        if (value == null) {
            return null;
        }
        return value.matches("(?s)^[\\s\\uFEFF]*[=+@-].*|^[\\t\\r\\n].*") ? "'" + value : value;
    }

    /** 严格按 UTF-8 解码，遇到非法字节立即报错，避免静默替换。 */
    static String decode(byte[] content) throws CharacterCodingException {
        return StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(content))
                .toString();
    }
}
