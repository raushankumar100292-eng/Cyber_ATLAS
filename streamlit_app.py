"""
ATLAS Command Center — Streamlit Cloud entry point.

The ATLAS Command Center is a React + TypeScript + Vite single-page app and
cannot be executed by Streamlit's Python runtime directly. This wrapper simply
embeds the live, already-deployed build (GitHub Pages) in a full-screen iframe
so the app can be reached from a *.streamlit.app URL.

To point this at a different deployment (e.g. Vercel), change APP_URL below.
"""

import streamlit as st
import streamlit.components.v1 as components

# Live deployment of the React build (GitHub Pages, base path /Cyber_ATLAS/)
APP_URL = "https://raushankumar100292-eng.github.io/Cyber_ATLAS/"

st.set_page_config(
    page_title="ATLAS Command Center",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Strip default Streamlit chrome so the embedded app fills the viewport.
st.markdown(
    """
    <style>
        #MainMenu, header, footer {visibility: hidden;}
        .block-container {padding: 0 !important; max-width: 100% !important;}
        [data-testid="stAppViewContainer"] > .main {padding: 0 !important;}
        iframe {border: none !important;}
    </style>
    """,
    unsafe_allow_html=True,
)

# Full-height embed of the deployed SPA.
components.iframe(APP_URL, height=900, scrolling=True)

# Fallback link in case the iframe is blocked by the browser.
st.markdown(
    f"<div style='text-align:center;padding:8px;font-family:sans-serif'>"
    f"If the app does not load, open it directly: "
    f"<a href='{APP_URL}' target='_blank'>{APP_URL}</a></div>",
    unsafe_allow_html=True,
)
