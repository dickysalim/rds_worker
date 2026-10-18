-- Server-side cache for generated Nota PDFs. Client builds the PDF once
-- (jsPDF, client-side only — Workers runtime doesn't run jsPDF), uploads the
-- blob via PUT /nota/:id/pdf, and the key is stored here so later
-- downloads/previews skip regeneration entirely. Nota are immutable once
-- created (only void changes state), so this cache only needs invalidating
-- on void.
ALTER TABLE nota ADD COLUMN pdf_r2_key TEXT;
