-- customer: only one active row per company_name
CREATE UNIQUE INDEX idx_customer_company_name_active ON customer (company_name) WHERE is_active = 1;

-- customer_contact: phone_number must be unique across all active contacts (B2B, not shared between customers)
CREATE UNIQUE INDEX idx_customer_contact_phone_active ON customer_contact (phone_number) WHERE is_active = 1;
