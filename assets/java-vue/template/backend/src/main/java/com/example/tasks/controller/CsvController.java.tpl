package com.example.tasks.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.service.CsvService;
import com.example.tasks.vo.ImportResult;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/tasks")
public class CsvController {
    private final CsvService service;

    public CsvController(CsvService service) {
        this.service = service;
    }

    @PostMapping(value = "/import/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportResult> validate(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(service.ingest(file, false));
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportResult> ingest(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(service.ingest(file, true));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String title,
            @RequestParam(required = false) Boolean completed) {
        return download(service.export(title, completed), "tasks.csv");
    }

    @GetMapping("/import/template")
    public ResponseEntity<byte[]> template() {
        return download(service.template(), "task-template.csv");
    }

    private ResponseEntity<byte[]> download(byte[] bytes, String filename) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"")
                .body(bytes);
    }
}
