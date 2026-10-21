package com.example.tasks.vo;

import com.example.tasks.entity.StoredFile;

public final class FileVO {
    private final String fileId;
    private final String name;
    private final String mediaType;
    private final long size;

    public FileVO(StoredFile file) {
        this.fileId = file.getId();
        this.name = file.getName();
        this.mediaType = file.getMediaType();
        this.size = file.getSize();
    }

    public String getFileId() {
        return fileId;
    }

    public String getName() {
        return name;
    }

    public String getMediaType() {
        return mediaType;
    }

    public long getSize() {
        return size;
    }

    public String getDownloadUrl() {
        return "/api/files/" + fileId + "/download";
    }
}
