import { describe, expect, it } from "vitest";
import { parseMysqlDump } from "../dump-parser";

const MISSING_TABLE_RE = /utenti/;
const BAD_ROW_RE = /clienti/;

const DUMP = `
-- MySQL dump
/*!40101 SET NAMES utf8 */;
DROP TABLE IF EXISTS \`clienti\`;
CREATE TABLE \`clienti\` (
  \`id\` int(4) NOT NULL AUTO_INCREMENT,
  \`nome\` varchar(50) CHARACTER SET latin1 NOT NULL,
  \`commenti\` longtext COLLATE utf8_unicode_ci NOT NULL,
  \`data\` date NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8;
LOCK TABLES \`clienti\` WRITE;
INSERT INTO \`clienti\` VALUES (1,'João','linha 1\\nlinha 2','2020-01-02'),(2,'O\\'Neil','a, (b); c\\\\d','2021-03-04');
INSERT INTO \`clienti\` VALUES (3,'Ana','','2022-05-06');
UNLOCK TABLES;
CREATE TABLE \`oggetti\` (
  \`ID\` int(255) NOT NULL AUTO_INCREMENT,
  \`dataChiusura\` datetime DEFAULT NULL,
  \`Prezzo\` int(255) NOT NULL,
  PRIMARY KEY (\`ID\`)
) ENGINE=MyISAM;
INSERT INTO \`oggetti\` VALUES (7,NULL,45),(8,'2024-01-01 10:00:00',-3);
CREATE TABLE \`ignorada\` (
  \`x\` int NOT NULL
);
INSERT INTO \`ignorada\` VALUES (1);
`;

describe("parseMysqlDump", () => {
  const result = parseMysqlDump(DUMP, ["clienti", "oggetti"]);

  it("maps every row to the CREATE TABLE column names", () => {
    expect(result.clienti).toHaveLength(3);
    expect(result.clienti?.[0]).toEqual({
      commenti: "linha 1\nlinha 2",
      data: "2020-01-02",
      id: "1",
      nome: "João",
    });
  });

  it("decodes escaped quotes, backslashes and separators inside strings", () => {
    expect(result.clienti?.[1]?.nome).toBe("O'Neil");
    expect(result.clienti?.[1]?.commenti).toBe("a, (b); c\\d");
  });

  it("reads NULL as null and keeps numbers as their literal text", () => {
    expect(result.oggetti).toEqual([
      { dataChiusura: null, ID: "7", Prezzo: "45" },
      { dataChiusura: "2024-01-01 10:00:00", ID: "8", Prezzo: "-3" },
    ]);
  });

  it("only returns the requested tables", () => {
    expect(Object.keys(result).sort()).toEqual(["clienti", "oggetti"]);
  });

  it("fails loudly when a requested table is missing", () => {
    expect(() => parseMysqlDump(DUMP, ["clienti", "utenti"])).toThrow(
      MISSING_TABLE_RE
    );
  });

  it("reads INSERTs with a column list, INSERT IGNORE and REPLACE", () => {
    const dump = `CREATE TABLE \`t\` (
  \`a\` int NOT NULL,
  \`b\` varchar(5) NOT NULL
);
INSERT INTO \`t\` (\`b\`, \`a\`) VALUES ('x',1);
INSERT IGNORE INTO \`t\` VALUES (2,'y');
REPLACE INTO \`t\` VALUES (3,'z');
`;
    expect(parseMysqlDump(dump, ["t"]).t).toEqual([
      { a: "1", b: "x" },
      { a: "2", b: "y" },
      { a: "3", b: "z" },
    ]);
  });

  it("accepts Windows line endings", () => {
    const crlf = DUMP.replaceAll("\n", "\r\n");
    expect(parseMysqlDump(crlf, ["clienti"]).clienti).toHaveLength(3);
  });

  it("does not parse tables it was not asked for", () => {
    const withGarbage = `${DUMP}\nINSERT INTO \`ignorada\` VALUES (1,'sem fim`;
    expect(parseMysqlDump(withGarbage, ["clienti"]).clienti).toHaveLength(3);
  });

  it("rejects a row whose width does not match the table", () => {
    const broken = DUMP.replace("(3,'Ana','','2022-05-06')", "(3,'Ana','')");
    expect(() => parseMysqlDump(broken, ["clienti"])).toThrow(BAD_ROW_RE);
  });
});
