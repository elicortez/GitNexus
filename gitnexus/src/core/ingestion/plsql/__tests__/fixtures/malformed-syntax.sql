CREATE OR REPLACE PACKAGE not valid SQL at all...
this is intentionally broken syntax for testing
the regex fallback path when ANTLR4 parsing fails

PROCEDURE still_detectable(p1 IN NUMBER) IS
BEGIN
  NULL;
END;

FUNCTION another_one(p1 IN VARCHAR2) RETURN BOOLEAN IS
BEGIN
  RETURN TRUE;
END;
