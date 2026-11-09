-- Which business identity (primary or an alias row in `business`) issued
-- this nota. NULL = the primary business row.
ALTER TABLE nota ADD COLUMN business_id INTEGER REFERENCES business (business_id);
