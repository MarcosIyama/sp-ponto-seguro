import geopandas as gpd

# =========================
# 📥 carregar arquivo original
# =========================
gdf = gpd.read_file("../database/geo/ponto_onibus.geojson")


# =========================
# 🔄 converter CRS
# =========================
gdf = gdf.to_crs(epsg=4326)

# =========================
# 💾 salvar arquivo corrigido
# =========================
gdf.to_file(
    "database/geo/ponto_onibus_corrigido.geojson",
    driver="GeoJSON"
)

print("feito")