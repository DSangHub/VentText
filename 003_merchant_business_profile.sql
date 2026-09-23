-- Apply to the same schema used by the VentText API (venttext by default).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_person TEXT;
