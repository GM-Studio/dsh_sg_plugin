<?xml version="1.0"?>
<!DOCTYPE module PUBLIC "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN" "https://checkstyle.org/dtds/configuration_1_3.dtd">
<module name="Checker">
  <module name="TreeWalker">
    <module name="AvoidStarImport"/>
    <module name="EmptyStatement"/>
    <module name="OneStatementPerLine"/>
    <module name="IllegalImport"/>
    <module name="TypeName"/>
    <module name="MethodName"><property name="format" value="^([a-z][a-zA-Z0-9]*|AC[0-9]{3}_[a-z][a-zA-Z0-9]*)$"/></module>
    <module name="MemberName"/>
    <module name="ParameterName"/>
    <module name="ConstantName"/>
    <module name="ModifierOrder"/>
    <module name="EqualsHashCode"/>
    <module name="AvoidNestedBlocks"/>
  </module>
</module>
