#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  ============================================="
echo "    PDF Tools"
echo "  ============================================="
echo ""

# Check Python 3
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 not found."
    echo "Please install it from https://python.org"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# Create virtual environment if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate
source venv/bin/activate

# Install dependencies if needed
if ! pip show pymupdf &>/dev/null 2>&1; then
    echo "Installing dependencies (first run only, please wait)..."
    pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install dependencies."
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# Start server and open browser
echo ""
echo "  Starting... opening http://localhost:5000"
echo "  Close this window to stop the server."
echo ""
sleep 1
open http://localhost:5000
python app.py

deactivate
