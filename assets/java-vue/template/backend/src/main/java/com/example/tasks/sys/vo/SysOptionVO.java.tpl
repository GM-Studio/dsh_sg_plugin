package com.acme.orders.sys.vo;

/** 下拉选项视图对象：value 为提交值（如角色编码），label 为展示名称。 */
public final class SysOptionVO {
    private final String value;
    private final String label;

    public SysOptionVO(String value, String label) {
        this.value = value;
        this.label = label;
    }

    public String getValue() {
        return value;
    }

    public String getLabel() {
        return label;
    }
}
