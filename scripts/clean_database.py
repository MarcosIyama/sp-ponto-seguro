import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import json

# =========================
# LISTA DATAFRAMES
# =========================
dfs = []

# =========================
# LER EXCELS
# =========================
for ano in range(2023, 2027):

    arquivo = f"database/raw/celulares_subtraidos_{ano}.xlsx"
    aba = f"CELULAR_{ano}"

    try:

        df = pd.read_excel(
            arquivo,
            sheet_name=aba
        )

        print(f"Arquivo carregado: {ano}")

        # =========================
        # COLUNAS
        # =========================
        df = df[[
            "DATA_OCORRENCIA_BO",
            "HORA_OCORRENCIA",
            "NOME_MUNICIPIO",
            "RUBRICA",
            "BAIRRO",
            "CEP",
            "LOGRADOURO",
            "LATITUDE",
            "LONGITUDE"
        ]]

        # =========================
        # FILTROS
        # =========================
        df = df[
            df["NOME_MUNICIPIO"] == "S.PAULO"
        ]

        df = df[
            df["RUBRICA"] == "Roubo (art. 157)"
        ]

        # =========================
        # RENOMEAR
        # =========================
        df = df.rename(columns={

            "DATA_OCORRENCIA_BO": "data",
            "HORA_OCORRENCIA": "hora",
            "NOME_MUNICIPIO": "municipio",
            "RUBRICA": "tipo_crime",
            "BAIRRO": "bairro",
            "CEP": "cep",
            "LOGRADOURO": "logradouro",
            "LATITUDE": "lat",
            "LONGITUDE": "lon"

        })

        # =========================
        # LIMPEZA
        # =========================
        df["lat"] = pd.to_numeric(
            df["lat"],
            errors="coerce"
        )

        df["lon"] = pd.to_numeric(
            df["lon"],
            errors="coerce"
        )

        df = df.dropna(subset=["lat", "lon"])

        # adicionar ano
        df["ano"] = ano

        dfs.append(df)

        print(f"Dados tratados: {ano}")

    except Exception as e:

        print(f"Erro em {arquivo}: {e}")

# =========================
# JUNTAR DATAFRAMES
# =========================
df_total = pd.concat(
    dfs,
    ignore_index=True
)

print(f"Total crimes: {len(df_total)}")

# =========================
# CONVERTER CRIMES PARA GEO
# =========================
gdf_crimes = gpd.GeoDataFrame(
    df_total,
    geometry=gpd.points_from_xy(
        df_total.lon,
        df_total.lat
    ),
    crs="EPSG:4326"
)

# =========================
# LER GEOJSON ÔNIBUS
# =========================
gdf_pontos = gpd.read_file(
    "database/geo/ponto_onibus_corrigido.geojson"
)

print(f"Pontos carregados: {len(gdf_pontos)}")

# =========================
# CONVERTER CRS
# UTM -> metros
# =========================
gdf_crimes = gdf_crimes.to_crs(
    epsg=31983
)

gdf_pontos = gdf_pontos.to_crs(
    epsg=31983
)

# =========================
# BUFFER 50m
# =========================
buffer_onibus = gdf_pontos.buffer(50)

# unir buffers
buffer_unido = buffer_onibus.union_all()

# =========================
# FILTRAR CRIMES
# =========================
crimes_filtrados = gdf_crimes[
    gdf_crimes.within(buffer_unido)
]

print(
    f"Crimes próximos: {len(crimes_filtrados)}"
)

# =========================
# VOLTAR PARA WGS84
# =========================
crimes_filtrados = crimes_filtrados.to_crs(
    epsg=4326
)

# remover geometry
crimes_filtrados = crimes_filtrados.drop(
    columns="geometry"
)

# =========================
# SALVAR CSV
# =========================
crimes_filtrados.to_csv(
    "database/processed/crimes_buffer_50m.csv",
    index=False,
    encoding="utf-8"
)

print("CSV filtrado salvo!")