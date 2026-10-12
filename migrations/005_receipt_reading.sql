ALTER TABLE venttext.messages
  ADD COLUMN IF NOT EXISTS receipt_read_status TEXT,
  ADD COLUMN IF NOT EXISTS receipt_business JSONB;

-- Twilio retries must not cause duplicate OCR charges or duplicate prompts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_inbound_twilio_sid
  ON venttext.messages (twilio_sid)
  WHERE direction='inbound' AND twilio_sid IS NOT NULL;
