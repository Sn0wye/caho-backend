-- Runs once on first postgres init (empty data dir).
-- Gives the test suite an isolated DB so it never touches app data.
CREATE DATABASE caho_test OWNER caho;
