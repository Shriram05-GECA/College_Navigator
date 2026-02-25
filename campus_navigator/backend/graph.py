import json
import os
import math
import networkx as nx

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NODES_FILE = os.path.join(BASE_DIR, "nodes.json")

class CampusGraph:
    def __init__(self):
        self.graph = nx.Graph()
        self.nodes_data = self.load_nodes()
        self.build_graph()

    def load_nodes(self):
        with open(NODES_FILE, "r", encoding="utf-8") as file:
            return json.load(file)

    def calculate_distance(self, x1, y1, x2, y2):
        return math.sqrt((x2 - x1)**2 + (y2 - y1)**2)

    def build_graph(self):
        nodes = self.nodes_data["nodes"]
        edges = self.nodes_data["edges"]

        for node in nodes:
            self.graph.add_node(
                node["id"],
                name=node["name"],
                x=node["x"],
                y=node["y"],
                type=node["type"]
            )

        for edge in edges:
            from_node = self.get_node_by_id(edge["from"])
            to_node = self.get_node_by_id(edge["to"])
            if from_node and to_node:
                distance = self.calculate_distance(
                    from_node["x"], from_node["y"],
                    to_node["x"], to_node["y"]
                )
                self.graph.add_edge(edge["from"], edge["to"], weight=distance)

    def get_node_by_id(self, node_id):
        for node in self.nodes_data["nodes"]:
            if node["id"] == node_id:
                return node
        return None

    def get_all_nodes(self):
        return self.nodes_data["nodes"]

    def get_all_edges(self):
        return self.nodes_data["edges"]

    def shortest_path(self, start_id, end_id):
        if start_id not in self.graph or end_id not in self.graph:
            return None, [], 0

        try:
            path = nx.shortest_path(
                self.graph,
                source=start_id,
                target=end_id,
                weight="weight"
            )

            total_distance = nx.shortest_path_length(
                self.graph,
                source=start_id,
                target=end_id,
                weight="weight"
            )

            coordinates = []
            for node_id in path:
                node = self.get_node_by_id(node_id)
                if node:
                    coordinates.append([node["y"], node["x"]])

            return path, coordinates, round(total_distance)

        except nx.NetworkXNoPath:
            return None, [], 0
