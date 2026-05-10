import pandas as pd
import openpyxl

dfs = []

for ano in range(2023, 2026):

    # caminho
    arquivo = f"database/raw/celulares_subtraidos_{ano}.xlsx"
    aba = f"CELULAR_{ano}"

    try:
        df = pd.read_excel(arquivo, sheet_name=aba)

        print(f"funfa {ano}")
        
        # =========================
        # SELECIONAR COLUNAS
        # =========================
        df = df[[
            "ANO_BO",
            "DATA_OCORRENCIA_BO",
            "HORA_OCORRENCIA",
            "NOME_MUNICIPIO",
            "RUBRICA",
            "BAIRRO",
            "CEP",
            "LOGRADOURO",
            "NUMERO_LOGRADOURO",
            "LATITUDE",
            "LONGITUDE"
        ]]

        df = df[df["NOME_MUNICIPIO"] == "S.PAULO"]

        # =========================
        # RENOMEAR
        # =========================
        df = df.rename(columns={
            "ANO_BO": "ano",
            "DATA_OCORRENCIA_BO": "data",
            "HORA_OCORRENCIA": "hora",
            "NOME_MUNICIPIO": "municipio",
            "RUBRICA": "tipo_crime",
            "BAIRRO": "bairro",
            "CEP": "cep",
            "LOGRADOURO": "logradouro",
            "NUMERO_LOGRADOURO": "numero",
            "LATITUDE": "lat",
            "LONGITUDE": "lon"
        })

        # =========================
        # LIMPEZA
        # =========================
        df = df.dropna(subset=["lat", "lon"])
        df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
        df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
        df = df.dropna(subset=["lat", "lon"])

        dfs.append(df)

    except Exception as e:
        print(f"erro {arquivo}: {e}")

# =========================
# JUNTAR E SALVAR
# =========================
if len(dfs) > 0:

    df_total = pd.concat(dfs, ignore_index=True)
    
    df_total.to_csv(
        "database/processed/crimes.csv",
        index=False,
        encoding="utf-8"
    )
    print(f"funfa final")