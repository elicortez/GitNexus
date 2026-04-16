CREATE OR REPLACE PACKAGE BODY order_processing AS

  g_last_error VARCHAR2(200);

  PROCEDURE log_event(
    p_order_id IN NUMBER,
    p_action   IN VARCHAR2
  ) IS
  BEGIN
    INSERT INTO order_audit_log (order_id, action, created_at)
    VALUES (p_order_id, p_action, SYSDATE);
  END log_event;

  PROCEDURE submit_order(
    p_customer_id IN NUMBER,
    p_order_id    OUT NUMBER
  ) IS
    v_total NUMBER(10,2) := 0;
  BEGIN
    INSERT INTO orders (customer_id, status, created_at)
    VALUES (p_customer_id, 'PENDING', SYSDATE)
    RETURNING order_id INTO p_order_id;

    v_total := pricing_engine.calculate_total(p_customer_id);
    UPDATE orders SET total = v_total WHERE order_id = p_order_id;

    log_event(p_order_id, 'SUBMITTED');
    notification_pkg.send_confirmation(p_customer_id, p_order_id);
  END submit_order;

  PROCEDURE cancel_order(
    p_order_id IN NUMBER,
    p_reason   IN VARCHAR2 DEFAULT NULL
  ) IS
  BEGIN
    UPDATE orders SET status = 'CANCELLED', cancel_reason = p_reason
    WHERE order_id = p_order_id;
    log_event(p_order_id, 'CANCELLED');
  END cancel_order;

  FUNCTION get_order_total(p_order_id IN NUMBER) RETURN NUMBER IS
    v_total NUMBER(10,2);
  BEGIN
    SELECT total INTO v_total FROM orders WHERE order_id = p_order_id;
    RETURN v_total;
  END get_order_total;

  FUNCTION is_order_valid(p_order_id IN NUMBER) RETURN BOOLEAN IS
    v_count PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO v_count
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_id = p_order_id AND o.status != 'CANCELLED';
    RETURN v_count > 0;
  END is_order_valid;

END order_processing;
/
