package com.example.tasks.entity;

import java.util.UUID;
import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "stored_files")
public class StoredFile {
    @Id private String id;

    @Column(nullable = false, length = 240)
    private String name;

    @Column(nullable = false)
    private String mediaType;

    @Column(nullable = false)
    private long size;

    protected StoredFile() {}

    public StoredFile(String name, String mediaType, long size) {
        this.id = UUID.randomUUID().toString();
        this.name = name;
        this.mediaType = mediaType;
        this.size = size;
    }

    public String getId() {
        return id;
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
}
