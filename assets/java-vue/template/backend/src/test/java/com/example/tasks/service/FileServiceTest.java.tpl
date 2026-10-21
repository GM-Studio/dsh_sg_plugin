package com.example.tasks.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.tasks.common.BusinessException;
import com.example.tasks.entity.StoredFile;
import com.example.tasks.repository.StoredFileRepository;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

class FileServiceTest {
    @TempDir Path directory;

    @Test
    void AC006_checksExtensionMimeAndContentTogether() throws Exception {
        assertEquals(
                "image/png",
                FileService.detect(
                        "image.PNG",
                        "image/png",
                        new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10}));
        assertEquals(
                "image/jpeg",
                FileService.detect(
                        "image.jpg",
                        "image/jpeg",
                        new byte[] {(byte) 255, (byte) 216, (byte) 255}));
        assertEquals(
                "image/jpeg",
                FileService.detect(
                        "image.jpeg",
                        "image/jpeg",
                        new byte[] {(byte) 255, (byte) 216, (byte) 255}));
        assertEquals(
                "application/pdf",
                FileService.detect(
                        "doc.pdf", "application/pdf", "%PDF-1.7".getBytes(StandardCharsets.UTF_8)));
        assertEquals(
                "text/csv",
                FileService.detect(
                        "data.csv", "text/plain", "a,b\n1,2".getBytes(StandardCharsets.UTF_8)));
        assertEquals(
                "text/plain",
                FileService.detect(
                        "doc.txt",
                        "text/plain;charset=UTF-8",
                        "text\tline\r\n".getBytes(StandardCharsets.UTF_8)));
        assertThrows(
                BusinessException.class, () -> FileService.detect("a.txt", null, new byte[] {65}));
        assertThrows(
                BusinessException.class,
                () -> FileService.detect("a.txt", "image/png", new byte[] {65}));
        assertThrows(
                BusinessException.class,
                () -> FileService.detect("a.txt", "text/plain", new byte[] {0}));
        assertThrows(
                BusinessException.class,
                () -> FileService.detect("a.csv", "text/csv", new byte[] {(byte) 255}));
        assertThrows(
                BusinessException.class,
                () -> FileService.detect("a.jpg", "image/jpeg", new byte[] {1}));
        assertThrows(
                BusinessException.class,
                () ->
                        FileService.detect(
                                "a.png",
                                "image/png",
                                new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 0}));
        assertThrows(
                BusinessException.class,
                () -> FileService.detect("a.pdf", "application/pdf", new byte[] {1}));
    }

    @Test
    void AC006_failedMetadataCommitCleansUpUploadedContent() throws Exception {
        StoredFileRepository repository = mock(StoredFileRepository.class);
        FileService service = new FileService(repository, directory.toString(), 1024);
        when(repository.saveAndFlush(any(StoredFile.class)))
                .thenThrow(new IllegalStateException("database unavailable"));
        assertEquals(
                500,
                assertThrows(
                                BusinessException.class,
                                () ->
                                        service.upload(
                                                new MockMultipartFile(
                                                        "file",
                                                        "hello.txt",
                                                        "text/plain",
                                                        new byte[] {65})))
                        .getStatus());
        try (java.util.stream.Stream<Path> paths = Files.list(directory)) {
            assertEquals(0, paths.count());
        }
        assertThrows(
                BusinessException.class,
                () ->
                        service.upload(
                                new MockMultipartFile("file", "", "text/plain", new byte[] {65})));
        assertThrows(
                BusinessException.class,
                () ->
                        service.upload(
                                new MockMultipartFile(
                                        "file", "empty.txt", "text/plain", new byte[] {})));
        Path blocked = Files.createFile(directory.resolve("not-a-directory"));
        FileService blockedService = new FileService(repository, blocked.toString(), 1024);
        assertEquals(
                "FILE_STORAGE",
                assertThrows(
                                BusinessException.class,
                                () ->
                                        blockedService.upload(
                                                new MockMultipartFile(
                                                        "file",
                                                        "hello.txt",
                                                        "text/plain",
                                                        new byte[] {65})))
                        .getCode());
    }

    @Test
    void AC005_preventsSpreadsheetFormulaInjectionIncludingMultilineCells() {
        for (String value :
                new String[] {"=SUM(1)", " +2", "@A1", "-3", "=HYPERLINK(\"url\")\nnext"}) {
            assertTrue(CsvService.safeCell(value).startsWith("'"));
        }
        assertEquals("ordinary", CsvService.safeCell("ordinary"));
    }
}
