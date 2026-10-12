-- business: drop nota_counter, add business_email
ALTER TABLE business DROP COLUMN nota_counter;
ALTER TABLE business ADD COLUMN business_email TEXT;
