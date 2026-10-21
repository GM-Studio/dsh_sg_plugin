package com.example.tasks.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.service.FileService;
import com.example.tasks.vo.FileVO;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/files")
public class FileController {
    private final FileService service;

    public FileController(FileService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<FileVO>> list() {
        return ApiResponse.success(service.list());
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<FileVO> upload(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(service.upload(file));
    }

    @GetMapping("/{id}")
    public ApiResponse<FileVO> metadata(@PathVariable String id) {
        return ApiResponse.success(service.metadata(id));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable String id) {
        FileVO file = service.metadata(id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.getMediaType()))
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment()
                                .filename(file.getName(), StandardCharsets.UTF_8)
                                .build()
                                .toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(service.download(id));
    }
}
