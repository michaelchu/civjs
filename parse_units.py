#!/usr/bin/env python3
"""
Parse freeciv classic units.ruleset to extract complete unit data
"""

import re
import json
from typing import Dict, List, Any, Optional

def parse_reqs(req_string: str) -> List[Dict[str, str]]:
    """Parse requirements section"""
    reqs = []
    if not req_string:
        return reqs
    
    # Simple parsing for Tech requirements
    tech_match = re.search(r'"Tech",\s*"([^"]+)"', req_string)
    if tech_match:
        reqs.append({
            "type": "Tech",
            "name": tech_match.group(1),
            "range": "Player"
        })
    
    return reqs

def parse_flags(flags_string: str) -> List[str]:
    """Parse flags string into list"""
    if not flags_string or flags_string.strip() == '""':
        return []
    
    # Remove quotes and split by comma
    flags_clean = flags_string.strip('"').strip()
    if not flags_clean:
        return []
    
    return [flag.strip().strip('"') for flag in flags_clean.split(',') if flag.strip()]

def parse_roles(roles_string: str) -> List[str]:
    """Parse roles string into list"""
    if not roles_string or roles_string.strip() == '""':
        return []
    
    # Remove quotes and split by comma
    roles_clean = roles_string.strip('"').strip()
    if not roles_clean:
        return []
    
    return [role.strip().strip('"') for role in roles_clean.split(',') if role.strip()]

def parse_unit_section(lines: List[str], start_idx: int) -> Dict[str, Any]:
    """Parse a single unit section starting at start_idx"""
    unit_data = {}
    i = start_idx
    
    # Skip the section header [unit_name]
    i += 1
    
    in_reqs = False
    reqs_buffer = ""
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Stop at next section
        if line.startswith('[') and not line.startswith('[unit_'):
            break
        if line.startswith('[unit_') and i > start_idx + 1:
            break
            
        # Handle requirements block
        if line.startswith('reqs'):
            in_reqs = True
            reqs_buffer = line
        elif in_reqs:
            reqs_buffer += " " + line
            if line.strip().endswith('}'):
                unit_data['reqs'] = parse_reqs(reqs_buffer)
                in_reqs = False
                reqs_buffer = ""
        else:
            # Parse regular key = value lines
            if '=' in line:
                parts = line.split('=', 1)
                if len(parts) == 2:
                    key = parts[0].strip()
                    value = parts[1].strip().strip('"')
                    
                    # Convert numeric values
                    if key in ['build_cost', 'pop_cost', 'attack', 'defense', 'hitpoints', 
                              'firepower', 'move_rate', 'vision_radius_sq', 'transport_cap', 
                              'fuel', 'uk_happy', 'uk_shield', 'uk_food', 'uk_gold']:
                        try:
                            unit_data[key] = int(value)
                        except ValueError:
                            unit_data[key] = value
                    elif key == 'flags':
                        unit_data[key] = parse_flags(value)
                    elif key == 'roles':
                        unit_data[key] = parse_roles(value)
                    else:
                        unit_data[key] = value
        
        i += 1
    
    return unit_data

def main():
    # Read the units.ruleset file
    ruleset_path = r"C:\Users\Michael\Documents\projects\civjs\reference\freeciv\data\classic\units.ruleset"
    
    with open(ruleset_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    units_data = {}
    
    # Find all unit sections
    for i, line in enumerate(lines):
        if re.match(r'^\[unit_(\w+)\]', line):
            unit_name = re.match(r'^\[unit_(\w+)\]', line).group(1)
            print(f"Parsing unit: {unit_name}")
            
            unit_data = parse_unit_section(lines, i)
            units_data[unit_name] = unit_data
    
    # Save to JSON file
    output_path = r"C:\Users\Michael\Documents\projects\civjs\freeciv_units_complete.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(units_data, f, indent=2, ensure_ascii=False)
    
    print(f"Extracted {len(units_data)} units to {output_path}")
    
    # Print summary
    for unit_name, data in units_data.items():
        tech_req = ""
        if 'reqs' in data and data['reqs']:
            for req in data['reqs']:
                if req['type'] == 'Tech':
                    tech_req = f" (requires {req['name']})"
                    break
        
        attack = data.get('attack', 0)
        defense = data.get('defense', 0) 
        hitpoints = data.get('hitpoints', 0)
        cost = data.get('build_cost', 0)
        movement = data.get('move_rate', 0)
        unit_class = data.get('class', 'Unknown')
        
        print(f"{unit_name}: {attack}/{defense}/{hitpoints} hp, {movement} move, {cost} cost, {unit_class} class{tech_req}")

if __name__ == "__main__":
    main()