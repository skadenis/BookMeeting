-- Migration: Add city field back to offices table
-- Date: 2025-08-27

-- Add city column back
ALTER TABLE offices ADD COLUMN city VARCHAR(120) NOT NULL DEFAULT 'Минск';

-- Update existing records to have a default city
UPDATE offices SET city = 'Минск' WHERE city IS NULL OR city = '';

-- Make city column NOT NULL after setting default values
ALTER TABLE offices ALTER COLUMN city SET NOT NULL;

-- Add comment to city column
COMMENT ON COLUMN offices.city IS 'City name for the office';
