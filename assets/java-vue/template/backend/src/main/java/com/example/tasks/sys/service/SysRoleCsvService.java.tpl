package com.example.tasks.sys.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.sys.entity.SysRole;
import com.example.tasks.sys.repository.SysRoleRepository;
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

/** 角色 CSV 导入导出服务：UTF-8 编码，限制文件大小与行数，导入先整体校验、后落库。 */
@Service
public class SysRoleCsvService {
    /** 固定表头，顺序即列顺序，导入时严格比对。 */
    private static final List<String> HEADER =
            Arrays.asList("code", "name", "description", "enabled");

    private final SysRoleRepository repository;
    private final SysRoleService roles;
    private final int maxRows;
    private final long maxBytes;

    /** 读取角色仓储、过滤服务以及 CSV 行数/字节上限配置。 */
    public SysRoleCsvService(
            SysRoleRepository repository,
            SysRoleService roles,
            @Value("${app.csv.max-rows}") int maxRows,
            @Value("${app.csv.max-bytes}") long maxBytes) {
        this.repository = repository;
        this.roles = roles;
        this.maxRows = maxRows;
        this.maxBytes = maxBytes;
    }

    /** 解析并校验 CSV：commit=false 只校验不落库，commit=true 先整表校验再一次性事务保存。 */
    @Transactional
    public ImportResult ingest(MultipartFile file, boolean commit) {
        if (file.isEmpty() || file.getSize() > maxBytes) {
            throw new BusinessException(
                    400, "CSV_SIZE", "CSV is empty or exceeds the configured limit");
        }
        List<SysRole> pending = new ArrayList<>();
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
                            400, "CSV_HEADER", "Expected code,name,description,enabled header");
                }
                int rows = 0;
                for (CSVRecord record : parser) {
                    if (++rows > maxRows) {
                        throw new BusinessException(400, "CSV_ROWS", "CSV exceeds row limit");
                    }
                    long line = record.getRecordNumber() + 1;
                    String code = record.size() > 0 ? record.get(0).trim() : "";
                    String name = record.size() > 1 ? record.get(1).trim() : "";
                    String description = record.size() > 2 ? record.get(2).trim() : "";
                    String enabled = record.size() > 3 ? record.get(3).trim() : "";
                    if (record.size() != 4
                            || code.isEmpty()
                            || code.length() > 64
                            || name.isEmpty()
                            || name.length() > 128
                            || description.length() > 255
                            || !("true".equals(enabled) || "false".equals(enabled))) {
                        errors.add(
                                "Row "
                                        + line
                                        + ": code must contain 1–64 characters; name must contain 1–128 characters; description must be at most 255 characters; enabled must be true or false; exactly four columns required");
                    } else if (!seen.add(code) || repository.findByCode(code).isPresent()) {
                        errors.add("Row " + line + ": role code already exists");
                    } else {
                        pending.add(
                                new SysRole(
                                        code,
                                        name,
                                        description.isEmpty() ? null : description,
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

    /** 按 code/name 过滤导出角色，超出配置行数上限时提示先收窄过滤条件。 */
    @Transactional(readOnly = true)
    public byte[] export(String code, String name) {
        org.springframework.data.domain.Page<SysRole> page =
                repository.findAll(
                        roles.filter(code, name),
                        PageRequest.of(0, maxRows, org.springframework.data.domain.Sort.by("id")));
        if (page.getTotalElements() > maxRows) {
            throw new BusinessException(400, "EXPORT_ROWS", "Narrow the filter before exporting");
        }
        try {
            StringWriter writer = new StringWriter();
            writer.write('\uFEFF');
            try (CSVPrinter printer = new CSVPrinter(writer, CSVFormat.DEFAULT)) {
                printer.printRecord("code", "name", "description", "enabled");
                for (SysRole role : page.getContent()) {
                    printer.printRecord(
                            safeCell(role.getCode()),
                            safeCell(role.getName()),
                            safeCell(role.getDescription()),
                            role.isEnabled());
                }
            }
            return writer.toString().getBytes(StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new BusinessException(500, "EXPORT_FAILED", "Unable to export CSV");
        }
    }

    /** 下载用模板：仅含表头与一行示例，避免误导入。 */
    public byte[] template() {
        return "code,name,description,enabled\r\nadmin,Administrator,Example role,true\r\n"
                .getBytes(StandardCharsets.UTF_8);
    }

    /** 转义可能被表格软件当作公式执行的单元格，description 允许为空。 */
    static String safeCell(String value) {
        if (value == null) {
            return null;
        }
        return value.matches("(?s)^[\\s\\uFEFF]*[=+@-].*|^[\\t\\r\\n].*") ? "'" + value : value;
    }

    /** 以严格 UTF-8 解码字节流，遇到非法字节直接失败而非静默替换。 */
    static String decode(byte[] content) throws CharacterCodingException {
        return StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(content))
                .toString();
    }
}
