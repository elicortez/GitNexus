CREATE OR REPLACE PROCEDURE cross_pkg_caller AS
BEGIN
  order_processing.submit_order(100, NULL);
  pricing_engine.calculate_total(100);
  log_event(1, 'TEST');
END cross_pkg_caller;
/
