"""Classify products into plant-based categories across European languages.

Retailer search for "tofu" is unambiguous, but a search for "vegan burger" also
returns beef burgers, and a search for "hafermilch" returns oat cookies. Every
row is therefore re-checked against a multilingual keyword model and rows that
look like animal products are flagged so they can be filtered out.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Tuple, Optional

# Category -> multilingual keywords (EN, DE, FR, NL, ES, IT, PL, SI, SE, DK, NO, CZ, PT)
CATEGORIES: Dict[str, List[str]] = {
    "tofu_tempeh_seitan": [
        "tofu", "tempeh", "seitan", "tofu naturell", "rauchertofu", "räuchertofu",
        "tofu fume", "tofu ahumado", "smoked tofu", "tofu affumicato",
    ],
    "plant_milk": [
        "oat milk", "soy milk", "almond milk", "rice milk", "coconut milk drink",
        "hafermilch", "haferdrink", "sojamilch", "sojadrink", "mandelmilch", "mandeldrink",
        "lait d'avoine", "boisson avoine", "lait de soja", "boisson soja", "lait d'amande",
        "havermelk", "haverdrink", "sojamelk", "amandelmelk",
        "bebida de avena", "leche de avena", "bebida de soja", "bebida de almendra",
        "latte di avena", "bevanda avena", "latte di soia", "bevanda soia",
        "napoj owsiany", "napój owsiany", "napoj sojowy",
        "ovseno mleko", "sojino mleko", "rastlinsko mleko",
        "havredryck", "sojadryck", "havredrik", "sojadrik", "havremelk",
        "ovesny napoj", "ovesný nápoj", "bebida de aveia",
        "plant milk", "plantaardige drink", "pflanzendrink", "pflanzlicher drink",
    ],
    "plant_meat": [
        "vegan burger", "veggie burger", "plant-based burger", "plant based burger",
        "vegetarische burger", "veggieburger", "gemuse burger",
        "vegane bratwurst", "veggie wurst", "vegane schnitzel", "vegane hackfleisch",
        "steak vegetal", "steak végétal", "haché végétal", "sans viande",
        "hamburguesa vegana", "hamburguesa vegetal", "carne vegetal",
        "hamburger vegetale", "affettato vegetale", "burger vegetariano",
        "vegetarische burger", "vegetarische gehakt", "vega burger", "vega gehakt",
        "burger roslinny", "burger roślinny", "kotlet wegański",
        "rastlinski burger", "vegi burger", "veganski burger",
        "vegansk burgare", "vegansk burger", "plantefars", "vaxtfars", "växtfärs",
        "vegan mince", "plant-based mince", "meat-free", "meat free",
        "no chicken", "no beef", "vegan nuggets", "vegane nuggets",
        "beyond meat", "garden gourmet", "vivera", "quorn", "planted", "heura",
        "juicy marbles", "redefine meat", "this isn't", "this isn't chicken",
    ],
    "plant_cheese": [
        "vegan cheese", "veganer kase", "veganer käse", "fromage vegetal",
        "fromage végétal", "queso vegano", "formaggio vegano", "vegan kaas",
        "veganski sir", "vegansk ost", "wegański ser", "plant-based cheese",
        "vegan mozzarella", "vegan cheddar", "cheese alternative",
    ],
    "plant_yoghurt": [
        "soy yoghurt", "soya yogurt", "coconut yoghurt", "oat yoghurt",
        "sojajoghurt", "kokosjoghurt", "haferjoghurt", "pflanzlicher joghurt",
        "yaourt vegetal", "yaourt végétal", "sojayoghurt", "plantaardige yoghurt",
        "yogur vegetal", "yogur de soja", "yogurt vegetale", "yogurt di soia",
        "sojin jogurt", "rastlinski jogurt", "vegansk yoghurt", "jogurt sojowy",
        "vegan yoghurt", "vegan yogurt",
    ],
    "legumes_pulses": [
        "chickpea", "lentil", "black bean", "kidney bean", "kichererbsen", "linsen",
        "pois chiche", "pois chiches", "lentille", "kikkererwten", "linzen",
        "garbanzo", "lenteja", "ceci", "lenticchie", "ciecierzyca", "soczewica",
        "cicerika", "čičerika", "leca", "leča", "kikarter", "linser", "kikaerter",
        "cizrna", "cocka", "čočka", "grao de bico", "grão de bico",
    ],
}

# Strong signals that a row is an animal product despite matching a search term.
ANIMAL_MARKERS = [
    "beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "salmon",
    "tuna", "prawn", "shrimp", "cow milk", "cows milk", "whey",
    "rind", "schwein", "hahnchen", "hähnchen", "pute", "lachs", "kuhmilch", "molke",
    "boeuf", "porc", "poulet", "dinde", "jambon", "saumon", "lait de vache",
    "rund", "varken", "kip", "kalkoen", "zalm", "koemelk",
    "ternera", "cerdo", "pollo", "pavo", "jamon", "jamón", "salmon", "leche de vaca",
    "manzo", "maiale", "pollo", "tacchino", "prosciutto", "salmone", "latte vaccino",
    "wolowina", "wołowina", "wieprzowina", "kurczak", "szynka", "losos",
    "govedina", "svinjina", "piscanec", "piščanec", "sunka", "šunka",
    "notkott", "nötkött", "flask", "fläsk", "kyckling", "skinka", "lax",
]

VEGAN_MARKERS = ["vegan", "veganes", "vegane", "végan", "vegana", "vegano",
                 "veganski", "wegański", "wegansk", "plantaardig", "pflanzlich",
                 "vegetal", "végétal", "vegetale", "roslinny", "roślinny",
                 "rastlinski", "plant-based", "plant based", "växtbaserad",
                 "plantebaseret", "vaxtbaserad"]


def _fold(text: str) -> str:
    """Lowercase and strip diacritics so 'Räuchertofu' matches 'rauchertofu'."""
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", str(text).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s)


def classify(name: str, extra_text: str = "") -> Tuple[Optional[str], bool, List[str]]:
    """Return (category, is_plant_based, matched_terms) for a product name."""
    hay = _fold(f"{name} {extra_text}")
    if not hay.strip():
        return None, False, []

    matched: List[str] = []
    category: Optional[str] = None
    for cat, terms in CATEGORIES.items():
        for t in terms:
            if _fold(t) in hay:
                matched.append(t)
                if category is None:
                    category = cat
    # A dedicated plant category wins over the generic legume bucket.
    if category == "legumes_pulses" and len(set(m for m in matched)) > 1:
        for cat, terms in CATEGORIES.items():
            if cat != "legumes_pulses" and any(_fold(t) in hay for t in terms):
                category = cat
                break

    has_vegan_marker = any(_fold(v) in hay for v in VEGAN_MARKERS)
    has_animal_marker = any(_fold(a) in hay for a in ANIMAL_MARKERS)

    plant_based = bool(category) or has_vegan_marker
    if has_animal_marker and not has_vegan_marker:
        # e.g. "chicken burger" surfaced by a "veggie burger" search
        plant_based = False

    return category, plant_based, sorted(set(matched))[:6]
