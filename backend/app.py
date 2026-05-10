from flask import Flask, jsonify, send_file
import sqlite3
import os
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# =========================
# CAMINHO BASE
# =========================
BASE_DIR = os.path.dirname(__file__)

# =========================
# CONEXÃO COM BANCO
# =========================
def get_db_connection():
    caminho_db = os.path.join(
        BASE_DIR,
        "..",
        "database",
        "sp_ponto_seguro.db"
    )

    conn = sqlite3.connect(caminho_db)
    conn.row_factory = sqlite3.Row
    return conn

# =========================
# API - CRIMES
# =========================
@app.route("/api/crimes")
def get_crimes():
    conn = get_db_connection()
    dados = conn.execute("SELECT * FROM crimes").fetchall()
    conn.close()

    return jsonify([dict(row) for row in dados])

# =========================
# API - GEOJSON
# =========================
@app.route("/api/pontos_onibus")
def pontos_onibus():

    caminho_geojson = os.path.join(
        BASE_DIR,
        "..",
        "database",
        "geo",
        "ponto_onibus_corrigido.geojson"
    )

    return send_file(caminho_geojson)

# =========================
# RODAR SERVIDOR
# =========================
if __name__ == "__main__":
    app.run(debug=True)