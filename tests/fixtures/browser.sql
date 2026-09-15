CREATE TABLE IF NOT EXISTS browser_records (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(150), status VARCHAR(30) DEFAULT 'active');
CREATE TABLE IF NOT EXISTS lookup_people (id BIGINT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100));
INSERT IGNORE INTO lookup_people VALUES (9007199254740993,'Alice Friendly','alice.lookup@example.test'),(42,'Bob Friendly','bob.lookup@example.test');
CREATE TABLE IF NOT EXISTS lookup_orders (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL, person_id BIGINT NULL, FOREIGN KEY (person_id) REFERENCES lookup_people(id));
CREATE TABLE IF NOT EXISTS z_editor_records (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'draft', day DATE NULL, happened DATETIME(6) NULL, stamped TIMESTAMP(6) NULL);
