CREATE OR REPLACE TRIGGER trg_orders_audit
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSDATE;
  IF INSERTING THEN
    :NEW.created_at := SYSDATE;
  END IF;
END trg_orders_audit;
/
