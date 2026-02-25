from flask import Flask, send_from_directory, jsonify, request
import os
import networkx as nx
from graph import CampusGraph

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")
ASSETS_DIR = os.path.join(BASE_DIR, "../assets")

app = Flask(__name__, static_folder=FRONTEND_DIR)
campus_graph = CampusGraph()

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/frontend/<path:filename>")
def frontend_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

@app.route("/assets/<path:filename>")
def assets_files(filename):
    return send_from_directory(ASSETS_DIR, filename)

@app.route("/api/nodes", methods=["GET"])
def get_nodes():
    return jsonify({"nodes": campus_graph.get_all_nodes()})

@app.route("/api/edges", methods=["GET"])
def get_edges():
    return jsonify({"edges": campus_graph.get_all_edges()})

@app.route("/api/node/<node_id>", methods=["GET"])
def get_node(node_id):
    node = campus_graph.get_node_by_id(node_id)
    if node:
        return jsonify(node)
    return jsonify({"error": "Node not found"}), 404

@app.route("/find_path", methods=["POST"])
def find_path():
    data = request.get_json()
    start = data.get("start")
    end = data.get("end")

    if not start or not end:
        return jsonify({"path": None, "error": "Missing start or end"})

    path_ids, coordinates, distance = campus_graph.shortest_path(start, end)

    if not path_ids:
        return jsonify({"path": None, "error": "No path found"})

    # Build step-by-step directions
    steps = []
    for i, node_id in enumerate(path_ids):
        node = campus_graph.get_node_by_id(node_id)
        if node:
            if i == 0:
                steps.append(f"Start at {node['name']}")
            elif i == len(path_ids) - 1:
                steps.append(f"Arrive at {node['name']}")
            else:
                steps.append(f"Pass through {node['name']}")

    return jsonify({
        "path": coordinates,
        "path_ids": path_ids,
        "steps": steps,
        "distance": distance,
        "estimated_time": max(1, round(distance / 80))  # ~80px per minute walking
    })

@app.route("/api/save_nodes", methods=["POST"])
def save_nodes():
    """Save updated nodes.json from the map editor"""
    data = request.get_json()
    if not data or "nodes" not in data or "edges" not in data:
        return jsonify({"error": "Invalid data"}), 400
    try:
        nodes_file = os.path.join(BASE_DIR, "nodes.json")
        with open(nodes_file, "w", encoding="utf-8") as f:
            import json
            json.dump(data, f, indent=2, ensure_ascii=False)
        # Reload graph
        campus_graph.__init__()
        return jsonify({"success": True, "message": "Graph saved and reloaded!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
