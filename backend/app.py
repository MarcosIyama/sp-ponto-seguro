from flask import Flask, jsonify, send_file, render_template
from flask_cors import CORS
import pandas as pd
import os

# Define caminhos absolutos a partir da raiz do projeto
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

app = Flask(__name__, 
            template_folder=os.path.join(PROJECT_ROOT, "frontend", "templates"), 
            static_folder=os.path.join(PROJECT_ROOT, "frontend", "static"))
CORS(app)

@app.route("/")
def home():
    # Renderiza o index.html
    return render_template("index.html")

# =========================
# API - CRIMES
# =========================
@app.route("/api/crimes")
def get_crimes():
    caminho_csv = os.path.join(PROJECT_ROOT, "database", "processed", "crimes_buffer_50m.csv")

    try:
        df = pd.read_csv(caminho_csv).fillna("")
        dados = df.to_dict(orient="records")
        print(f"Crimes enviados: {len(dados)}")
        return jsonify(dados)
    except Exception as e:
        print("Erro API crimes:", e)
        return jsonify({"erro": str(e)}), 500

# =========================
# API - PONTOS DE ÔNIBUS
# =========================
@app.route("/api/pontos_onibus")
def pontos_onibus():
    caminho_geojson = os.path.join(PROJECT_ROOT, "database", "geo", "ponto_onibus_corrigido.geojson")
    return send_file(caminho_geojson)

# =========================
# TESTE API
# =========================
@app.route("/status")
def status():
    return jsonify({"status": "API funcionando"})

# =========================
# RODAR SERVIDOR
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
