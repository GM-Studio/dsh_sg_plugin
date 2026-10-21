package com.example.tasks.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.entity.StoredFile;
import com.example.tasks.repository.StoredFileRepository;
import com.example.tasks.vo.FileVO;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class FileService {
    private final StoredFileRepository repository;
    private final Path directory;
    private final long maxBytes;

    public FileService(
            StoredFileRepository repository,
            @Value("${app.files.directory}") String directory,
            @Value("${app.files.max-bytes}") long maxBytes) {
        this.repository = repository;
        this.directory = Paths.get(directory).toAbsolutePath().normalize();
        this.maxBytes = maxBytes;
    }

    public List<FileVO> list() {
        return repository.findAll(PageRequest.of(0, 100)).getContent().stream()
                .map(FileVO::new)
                .collect(Collectors.toList());
    }

    public FileVO metadata(String id) {
        return new FileVO(find(id));
    }

    public StoredFile find(String id) {
        if (!id.matches("[a-f0-9-]{36}")) {
            throw new BusinessException(404, "FILE_NOT_FOUND", "File not found");
        }
        return repository
                .findById(id)
                .orElseThrow(() -> new BusinessException(404, "FILE_NOT_FOUND", "File not found"));
    }

    public FileVO upload(MultipartFile input) {
        String name = input.getOriginalFilename();
        if (name == null
                || name.isEmpty()
                || name.length() > 240
                || name.matches(".*[\\x00-\\x1f\\x7f/\\\\].*")) {
            throw new BusinessException(400, "FILE_NAME", "Invalid filename");
        }
        if (input.isEmpty() || input.getSize() > maxBytes) {
            throw new BusinessException(413, "FILE_SIZE", "File is empty or exceeds limit");
        }
        Path target = null;
        boolean written = false;
        try {
            byte[] bytes = input.getBytes();
            String mediaType = detect(name, input.getContentType(), bytes);
            StoredFile file = new StoredFile(name, mediaType, bytes.length);
            Files.createDirectories(directory);
            target = directory.resolve(file.getId());
            Files.write(target, bytes, StandardOpenOption.CREATE_NEW);
            written = true;
            // Repository transaction commits before returning; failed metadata writes clean up this
            // upload.
            repository.saveAndFlush(file);
            return new FileVO(file);
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException | RuntimeException exception) {
            if (written) {
                try {
                    Files.deleteIfExists(target);
                } catch (IOException cleanup) {
                    exception.addSuppressed(cleanup);
                }
            }
            throw new BusinessException(500, "FILE_STORAGE", "Unable to store file");
        }
    }

    public byte[] download(String id) {
        find(id);
        Path target = directory.resolve(id);
        try {
            if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                throw new BusinessException(404, "FILE_MISSING", "File content unavailable");
            }
            if (Files.size(target) > maxBytes) {
                throw new BusinessException(
                        413, "FILE_SIZE", "Stored file exceeds configured limit");
            }
            return Files.readAllBytes(target);
        } catch (IOException exception) {
            throw new BusinessException(500, "FILE_STORAGE", "Unable to read file");
        }
    }

    static String detect(String name, String claimed, byte[] bytes) throws IOException {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String type;
        if ("png".equals(extension)
                && bytes.length >= 8
                && bytes[0] == (byte) 0x89
                && bytes[1] == 'P'
                && bytes[2] == 'N'
                && bytes[3] == 'G'
                && bytes[4] == 13
                && bytes[5] == 10
                && bytes[6] == 26
                && bytes[7] == 10) {
            type = "image/png";
        } else if (("jpg".equals(extension) || "jpeg".equals(extension))
                && bytes.length >= 3
                && bytes[0] == (byte) 0xff
                && bytes[1] == (byte) 0xd8
                && bytes[2] == (byte) 0xff) {
            type = "image/jpeg";
        } else if ("pdf".equals(extension)
                && new String(
                                bytes,
                                0,
                                Math.min(5, bytes.length),
                                java.nio.charset.StandardCharsets.US_ASCII)
                        .equals("%PDF-")) {
            type = "application/pdf";
        } else if ("csv".equals(extension) || "txt".equals(extension)) {
            String text;
            try {
                text = CsvService.decode(bytes);
            } catch (java.nio.charset.CharacterCodingException exception) {
                throw new BusinessException(400, "FILE_TYPE", "Text must be UTF-8");
            }
            if (text.chars()
                    .anyMatch(
                            character ->
                                    character < 32
                                            && character != 9
                                            && character != 10
                                            && character != 13)) {
                throw new BusinessException(400, "FILE_TYPE", "Binary content is not text");
            }
            type = "csv".equals(extension) ? "text/csv" : "text/plain";
        } else {
            throw new BusinessException(400, "FILE_TYPE", "Unsupported file type or content");
        }
        if (claimed == null
                || !(claimed.split(";")[0].equalsIgnoreCase(type)
                        || "csv".equals(extension) && "text/plain".equalsIgnoreCase(claimed))) {
            throw new BusinessException(
                    400, "FILE_TYPE", "Declared file type does not match content");
        }
        return type;
    }
}
