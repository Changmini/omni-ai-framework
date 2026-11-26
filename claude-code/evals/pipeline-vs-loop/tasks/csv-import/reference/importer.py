"""Bulk user import from CSV text: all rows or none."""
import csv
import io


class ImportReportError(Exception):
    def __init__(self, errors):
        super().__init__(f"{len(errors)} bad row(s)")
        self.errors = errors


def import_users_csv(store, text):
    if text.startswith("\ufeff"):
        text = text[1:]
    reader = csv.reader(io.StringIO(text))
    column, names, errors = None, [], []
    for row in reader:
        line = reader.line_num
        if not any(cell.strip() for cell in row):
            continue
        if column is None:
            header = [cell.strip().lower() for cell in row]
            if "name" not in header:
                raise ImportReportError([(line, "no name column")])
            column = header.index("name")
            continue
        name = row[column].strip() if column < len(row) else ""
        if not name:
            errors.append((line, "empty name"))
        else:
            names.append(name)
    if errors:
        raise ImportReportError(errors)
    return [store.create_user(name)["id"] for name in names]
