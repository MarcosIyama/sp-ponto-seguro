import pandas as pd
import sqlite3

# =========================
# carregar csv
# =========================
df = pd.read_csv("database/processed/crimes.csv")

# =========================
#  conectar ao banco
# =========================
conn = sqlite3.connect("database/sp_ponto_seguro.db")

# =========================
# salvar tabela
# =========================
df.to_sql("crimes", conn, if_exists="replace", index=False)

print("banco criado")

# =========================
# fechar conexão
# =========================
conn.close()
