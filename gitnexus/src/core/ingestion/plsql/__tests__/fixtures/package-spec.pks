CREATE OR REPLACE PACKAGE order_processing AS
  c_max_retries CONSTANT PLS_INTEGER := 3;

  CURSOR c_pending_orders RETURN orders%ROWTYPE;

  PROCEDURE submit_order(
    p_customer_id IN NUMBER,
    p_order_id    OUT NUMBER
  );

  PROCEDURE cancel_order(
    p_order_id IN NUMBER,
    p_reason   IN VARCHAR2 DEFAULT NULL
  );

  FUNCTION get_order_total(p_order_id IN NUMBER) RETURN NUMBER;

  FUNCTION is_order_valid(p_order_id IN NUMBER) RETURN BOOLEAN;
END order_processing;
/
