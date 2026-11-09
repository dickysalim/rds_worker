-- Tax on the nota total (e.g. PPh 21, 11%). NULL = no tax applied.
ALTER TABLE nota ADD COLUMN pajak_name TEXT;
ALTER TABLE nota ADD COLUMN pajak_percentage REAL;
