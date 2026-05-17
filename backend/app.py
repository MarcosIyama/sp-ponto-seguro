from flask import Flask, jsonify, send_file, render_template
from flask_cors import CORS
import pandas as pd
import os

app = Flask(__name__, template_folder="../frontend/templates", static_folder="../frontend/static")
CORS(app)

# =========================
# CAMINHO BASE
# =========================
BASE_DIR = os.path.dirname(__file__)

@app.route("/")
def home():
    # Renderiza o index.html em vez de JSON
    return render_template("index.html")

# =========================
# API - CRIMES
# =========================
@app.route("/api/crimes")
def get_crimes():

    caminho_csv = os.path.join(
        BASE_DIR,
        "..",
        "database",
        "processed",
        "crimes_buffer_50m.csv"
    )

    try:

        # =========================
        # LER CSV
        # =========================
        df = pd.read_csv(caminho_csv)

        # =========================
        # REMOVER NaN
        # =========================
        df = df.fillna("")

        # =========================
        # CONVERTER PARA JSON
        # =========================
        dados = df.to_dict(orient="records")

        print(f"Crimes enviados: {len(dados)}")

        return jsonify(dados)

    except Exception as e:

        print("Erro API crimes:", e)

        return jsonify({
            "erro": str(e)
        }), 500


# =========================
# API - PONTOS DE ÔNIBUS
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
# TESTE API
# =========================
@app.route("/status")
def home():

    return jsonify({
        "status": "API funcionando"
    })


# =========================
# RODAR SERVIDOR
# =========================
if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
