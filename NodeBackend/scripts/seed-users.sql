-- Create sample users for multi-user WhatsApp system
INSERT INTO users (
  id, 
  username, 
  name, 
  role, 
  clinic_name, 
  contact_email, 
  contact_whatsapp, 
  whatsapp_integration_available, 
  max_sessions,
  created_at,
  updated_at
) VALUES 
  (
    'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    'admin@clinic.com',
    'Dr. Sarah Johnson',
    'admin',
    'Advanced Medical Center',
    'admin@clinic.com',
    '+1234567890',
    true,
    3,
    NOW(),
    NOW()
  ),
  (
    'b2c3d4e5-f6g7-8901-2345-6789abcdef01',
    'receptionist@clinic.com',
    'Maria Garcia',
    'receptionist',
    'Advanced Medical Center',
    'receptionist@clinic.com',
    '+1234567891',
    true,
    1,
    NOW(),
    NOW()
  ),
  (
    'c3d4e5f6-g7h8-9012-3456-789abcdef012',
    'lab.tech@clinic.com',
    'John Smith',
    'technician',
    'Advanced Medical Center',
    'lab.tech@clinic.com',
    '+1234567892',
    true,
    2,
    NOW(),
    NOW()
  ),
  (
    'd4e5f6g7-h8i9-0123-4567-89abcdef0123',
    'doctor@clinic2.com',
    'Dr. Michael Chen',
    'doctor',
    'City Health Clinic',
    'doctor@clinic2.com',
    '+1234567893',
    true,
    2,
    NOW(),
    NOW()
  );

-- Display the created users
SELECT 
  name,
  role,
  clinic_name,
  max_sessions,
  whatsapp_integration_available
FROM users
ORDER BY role;