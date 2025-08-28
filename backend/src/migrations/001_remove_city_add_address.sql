-- Migration: Remove name and city fields, keep only address
-- Date: 2025-08-27

-- Remove name column (office names like "Витебский филиал" are not needed)
ALTER TABLE offices DROP COLUMN IF EXISTS name;

-- Remove city column
ALTER TABLE offices DROP COLUMN IF EXISTS city;

-- Update address column to be more descriptive
ALTER TABLE offices ALTER COLUMN address TYPE VARCHAR(200);
ALTER TABLE offices ALTER COLUMN address SET NOT NULL;

-- Add comment to address column
COMMENT ON COLUMN offices.address IS 'Full office address in format "ул Ленина - Минск"';
