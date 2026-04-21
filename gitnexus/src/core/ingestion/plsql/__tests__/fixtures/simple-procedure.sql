CREATE OR REPLACE PROCEDURE calculate_bonus(
  p_employee_id IN NUMBER,
  p_bonus_pct   IN NUMBER DEFAULT 10,
  p_result      OUT NUMBER
) AS
  v_salary NUMBER;
BEGIN
  SELECT salary INTO v_salary
  FROM employees
  WHERE employee_id = p_employee_id;

  p_result := v_salary * p_bonus_pct / 100;

  INSERT INTO bonus_log (employee_id, bonus_amount, created_at)
  VALUES (p_employee_id, p_result, SYSDATE);
END calculate_bonus;
/
