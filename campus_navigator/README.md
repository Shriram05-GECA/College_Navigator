# 🧭 Campus Navigator

A smart campus navigation web app with Google Maps-style UI, shortest path routing, and location previews.

---

## 📁 Project Structure

```
campus_navigator/
├── backend/
│   ├── app.py          ← Flask server
│   ├── graph.py        ← NetworkX graph + pathfinding
│   └── nodes.json      ← Campus locations & connections
├── frontend/
│   ├── index.html      ← Main UI
│   ├── style.css       ← Dark premium theme
│   └── script.js       ← Leaflet map + API calls
├── assets/
│   └── campus_map.png  ← Your campus map image
└── requirements.txt
```

---

## 🚀 Setup & Run

### 1. Install dependencies
```bash
pip install flask networkx
```

### 2. Add your campus map
Place your campus map image at:
```
assets/campus_map.png
```

### 3. Run the server
```bash
cd backend
python app.py
```

### 4. Open in browser
```
http://localhost:5000
```

---

## 🗺️ Adding New Locations

Edit `backend/nodes.json` to add nodes:

```json
{
  "id": "your_location_id",
  "name": "Your Location Name",
  "x": 500,
  "y": 300,
  "type": "academic",
  "description": "Short description here.",
  "photo": "https://your-image-url.jpg",
  "hours": "8 AM – 6 PM",
  "facilities": ["WiFi", "Parking"]
}
```

**To find x/y coordinates:** Run the app, right-click anywhere on the map — the console will print the pixel coordinates you can use.

**Node types:** `academic`, `admin`, `food`, `sports`, `entrance`, `event`, `residential`, `intersection`

**Add edges** (connections between nodes):
```json
{ "from": "main_gate", "to": "your_location_id" }
```

---

## ✨ Features

- 🗺️ Interactive campus map (Leaflet.js + Simple CRS)
- 📍 Clickable location markers with Google Maps-style preview cards
- 🔍 Real-time search bar
- 🛣️ Shortest path with Dijkstra's algorithm (NetworkX)
- 📊 Turn-by-turn directions, distance & walk time
- 🎨 Premium dark UI with glowing markers
- 📱 Responsive with collapsible sidebar
