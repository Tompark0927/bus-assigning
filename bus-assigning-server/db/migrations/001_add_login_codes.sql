-- migrations/001_add_login_codes.sql
CREATE TABLE IF NOT EXISTS login_codes (
  phone      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
