package com.example.tasks.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.entity.Task;
import com.example.tasks.repository.TaskRepository;
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
import java.util.List;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class CsvService {
    private final TaskRepository repository;
    private final TaskService tasks;
    private final int maxRows;
    private final long maxBytes;

    public CsvService(
            TaskRepository repository,
            TaskService tasks,
            @Value("${app.csv.max-rows}") int maxRows,
            @Value("${app.csv.max-bytes}") long maxBytes) {
        this.repository = repository;
        this.tasks = tasks;
        this.maxRows = maxRows;
        this.maxBytes = maxBytes;
    }

    @Transactional
    public ImportResult ingest(MultipartFile file, boolean commit) {
        if (file.isEmpty() || file.getSize() > maxBytes) {
            throw new BusinessException(
                    400, "CSV_SIZE", "CSV is empty or exceeds the configured limit");
        }
        List<Task> pending = new ArrayList<>();
        List<String> errors = new ArrayList<>();
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
                if (!parser.getHeaderNames().equals(Arrays.asList("title", "completed"))) {
                    throw new BusinessException(
                            400, "CSV_HEADER", "Expected title,completed header");
                }
                int rows = 0;
                for (CSVRecord record : parser) {
                    if (++rows > maxRows) {
                        throw new BusinessException(400, "CSV_ROWS", "CSV exceeds row limit");
                    }
                    if (record.size() != 2
                            || record.get(0).trim().isEmpty()
                            || record.get(0).length() > 200
                            || !("true".equals(record.get(1)) || "false".equals(record.get(1)))) {
                        errors.add(
                                "Row "
                                        + (record.getRecordNumber() + 1)
                                        + ": title must contain 1–200 characters; completed must be true or false; exactly two columns required");
                    } else {
                        pending.add(
                                new Task(
                                        record.get(0).trim(), Boolean.parseBoolean(record.get(1))));
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

    @Transactional(readOnly = true)
    public byte[] export(String title, Boolean completed) {
        org.springframework.data.domain.Page<Task> page =
                repository.findAll(
                        tasks.filter(title, completed),
                        PageRequest.of(0, maxRows, org.springframework.data.domain.Sort.by("id")));
        if (page.getTotalElements() > maxRows) {
            throw new BusinessException(400, "EXPORT_ROWS", "Narrow the filter before exporting");
        }
        try {
            StringWriter writer = new StringWriter();
            writer.write('\uFEFF');
            try (CSVPrinter printer = new CSVPrinter(writer, CSVFormat.DEFAULT)) {
                printer.printRecord("title", "completed");
                for (Task task : page.getContent()) {
                    printer.printRecord(safeCell(task.getTitle()), task.isCompleted());
                }
            }
            return writer.toString().getBytes(StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new BusinessException(500, "EXPORT_FAILED", "Unable to export CSV");
        }
    }

    public byte[] template() {
        return "title,completed\r\nExample,false\r\n".getBytes(StandardCharsets.UTF_8);
    }

    static String safeCell(String value) {
        return value.matches("(?s)^[\\s\\uFEFF]*[=+@-].*|^[\\t\\r\\n].*") ? "'" + value : value;
    }

    static String decode(byte[] content) throws CharacterCodingException {
        return StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(content))
                .toString();
    }
}
