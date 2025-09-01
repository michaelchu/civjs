#!/usr/bin/env python3
"""
Create enhanced freeciv-compatible unit data structure based on the parsed units
"""

import json
import re

# Load the parsed unit data
with open(r'C:\Users\Michael\Documents\projects\civjs\freeciv_units_complete.json', 'r') as f:
    raw_units = json.load(f)

# Technology name mappings (freeciv to more readable names)
tech_mappings = {
    "Bronze Working": "bronze_working",
    "Warrior Code": "warrior_code", 
    "Iron Working": "iron_working",
    "Horseback Riding": "horseback_riding",
    "The Wheel": "the_wheel",
    "Map Making": "map_making",
    "Writing": "writing",
    "Pottery": "pottery",
    "Mathematics": "mathematics",
    "Chivalry": "chivalry",
    "Feudalism": "feudalism",
    "Navigation": "navigation",
    "Gunpowder": "gunpowder",
    "Magnetism": "magnetism",
    "Steam Engine": "steam_engine",
    "Metallurgy": "metallurgy",
    "Electricity": "electricity",
    "Machine Tools": "machine_tools",
    "Steel": "steel",
    "Industrialization": "industrialization",
    "Conscription": "conscription",
    "Leadership": "leadership",
    "Tactics": "tactics",
    "Flight": "flight",
    "Advanced Flight": "advanced_flight",
    "Rocketry": "rocketry",
    "Combined Arms": "combined_arms",
    "Amphibious Warfare": "amphibious_warfare",
    "Labor Union": "labor_union",
    "Mobile Warfare": "mobile_warfare",
    "Robotics": "robotics",
    "Stealth": "stealth",
    "Automobile": "automobile",
    "Combustion": "combustion",
    "Guerilla Warfare": "guerilla_warfare",
    "Explosives": "explosives",
    "Espionage": "espionage",
    "Trade": "trade",
    "The Corporation": "the_corporation",
    "Seafaring": "seafaring"
}

def clean_name(name_str):
    """Clean freeciv translated name strings"""
    if name_str.startswith('_("'):
        # Extract from _("name") format
        match = re.search(r'_\("([^"]+)"\)', name_str)
        if match:
            return match.group(1)
    elif name_str.startswith('_("?'):
        # Extract from _("?unit:name") format  
        match = re.search(r'_\("\?[^:]*:([^"]+)"\)', name_str)
        if match:
            return match.group(1)
    return name_str.strip('"')

def get_tech_requirement(unit_data):
    """Extract technology requirement"""
    if 'reqs' in unit_data and unit_data['reqs']:
        for req in unit_data['reqs']:
            if req.get('type') == 'Tech':
                tech_name = req.get('name', '')
                return tech_mappings.get(tech_name, tech_name.lower().replace(' ', '_'))
    return None

def get_obsolete_by(obsolete_str):
    """Convert obsolete_by to proper unit reference"""
    if obsolete_str and obsolete_str != "None":
        return obsolete_str.lower().replace(' ', '_')
    return None

# Enhanced units structure
enhanced_units = {}

for unit_id, unit_data in raw_units.items():
    # Clean up the unit data
    enhanced_unit = {
        "id": unit_id,
        "name": clean_name(unit_data.get("name", "")),
        
        # Core stats - exactly as in freeciv
        "attack": unit_data.get("attack", 0),
        "defense": unit_data.get("defense", 0),
        "hitpoints": unit_data.get("hitpoints", 10),
        "firepower": unit_data.get("firepower", 1),
        "move_rate": unit_data.get("move_rate", 1),
        "vision_radius_sq": unit_data.get("vision_radius_sq", 2),
        
        # Costs
        "build_cost": unit_data.get("build_cost", 10),
        "pop_cost": unit_data.get("pop_cost", 0),
        
        # Upkeep (uk_* fields)
        "uk_happy": unit_data.get("uk_happy", 0),
        "uk_shield": unit_data.get("uk_shield", 0), 
        "uk_food": unit_data.get("uk_food", 0),
        "uk_gold": unit_data.get("uk_gold", 0),
        
        # Transport and fuel
        "transport_cap": unit_data.get("transport_cap", 0),
        "fuel": unit_data.get("fuel", 0),
        
        # Unit classification
        "unit_class": unit_data.get("class", "Land"),
        "roles": unit_data.get("roles", []),
        "flags": unit_data.get("flags", []),
        
        # Technology and obsolescence
        "required_tech": get_tech_requirement(unit_data),
        "obsolete_by": get_obsolete_by(unit_data.get("obsolete_by")),
        
        # Additional freeciv fields
        "tp_defense": unit_data.get("tp_defense", "Alight"),
        "cargo": unit_data.get("cargo", []) if isinstance(unit_data.get("cargo"), list) else ([unit_data.get("cargo")] if unit_data.get("cargo") else []),
        
        # Graphics and sounds
        "graphic": unit_data.get("graphic", ""),
        "graphic_alt": unit_data.get("graphic_alt", "-"),
        "sound_move": unit_data.get("sound_move", ""),
        "sound_fight": unit_data.get("sound_fight", ""),
        
        # Veteran system (convert strings to proper values where needed)
        "veteran_levels": 4,  # freeciv classic has 4 levels
        "veteran_names": ["green", "veteran", "hardened", "elite"],
        "veteran_base_raise_chance": [50, 33, 20, 0],
        "veteran_work_raise_chance": [0, 0, 0, 0], 
        "veteran_power_fact": [100, 150, 175, 200],
        "veteran_move_bonus": [0, 0, 0, 0]
    }
    
    enhanced_units[unit_id] = enhanced_unit

# Create the final structure
final_structure = {
    "datafile": {
        "description": "Complete Classic unit data for CivJS (ported from freeciv classic ruleset)",
        "options": "+CivJS-ruleset-1.0-freeciv-classic-complete",
        "format_version": 2
    },
    "about": {
        "name": "Freeciv Classic Units Ruleset - Complete",
        "summary": "All 52 unit types from freeciv classic ruleset with exact stats, classes, roles, flags, and technology requirements",
        "source": "freeciv/data/classic/units.ruleset",
        "total_units": len(enhanced_units)
    },
    "unit_classes": {
        "land": {
            "name": "Land",
            "min_speed": 1,
            "hp_loss_pct": 0,
            "flags": ["TerrainSpeed", "DamageSlows", "CanOccupyCity", "BuildAnywhere", "CollectRansom", "ZOC", "CanFortify", "CanPillage", "TerrainDefense", "KillCitizen", "NonNatBombardTgt"]
        },
        "sea": {
            "name": "Sea", 
            "min_speed": 2,
            "hp_loss_pct": 0,
            "flags": ["DamageSlows", "AttackNonNative", "AttFromNonNative"]
        },
        "trireme": {
            "name": "Trireme",
            "min_speed": 2,
            "hp_loss_pct": 0, 
            "flags": ["DamageSlows", "AttFromNonNative"]
        },
        "air": {
            "name": "Air",
            "min_speed": 1,
            "hp_loss_pct": 0,
            "flags": ["Unreachable", "DoesntOccupyTile", "HutFrighten"]
        },
        "helicopter": {
            "name": "Helicopter",
            "min_speed": 1,
            "hp_loss_pct": 10,
            "flags": ["CanOccupyCity", "CollectRansom"]
        },
        "missile": {
            "name": "Missile",
            "min_speed": 1,
            "hp_loss_pct": 0,
            "flags": ["Missile", "Unreachable", "DoesntOccupyTile", "HutFrighten"]
        }
    },
    "units": enhanced_units
}

# Write the final enhanced structure
output_path = r'C:\Users\Michael\Documents\projects\civjs\freeciv_units_enhanced.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(final_structure, f, indent=2, ensure_ascii=False)

print(f"Enhanced unit data written to {output_path}")
print(f"Total units processed: {len(enhanced_units)}")

# Print summary by class
class_counts = {}
for unit_id, unit_data in enhanced_units.items():
    unit_class = unit_data["unit_class"]
    if unit_class not in class_counts:
        class_counts[unit_class] = []
    class_counts[unit_class].append(f"{unit_id} ({unit_data['attack']}/{unit_data['defense']}/{unit_data['hitpoints']})")

print("\nUnits by class:")
for unit_class, units in class_counts.items():
    print(f"\n{unit_class} ({len(units)} units):")
    for unit in units:
        print(f"  {unit}")

# Print units requiring technologies
print("\nTechnology requirements:")
tech_units = {}
for unit_id, unit_data in enhanced_units.items():
    tech = unit_data["required_tech"]
    if tech:
        if tech not in tech_units:
            tech_units[tech] = []
        tech_units[tech].append(unit_id)

for tech, units in sorted(tech_units.items()):
    print(f"{tech}: {', '.join(units)}")
