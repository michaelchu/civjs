import json
import math

# Technology data from freeciv ruleset parse
techs_raw = {
    'advanced_flight': {'internal_id': 'advanced_flight', 'order': 1, 'name': 'Advanced Flight', 'req1': 'Radio', 'req2': 'Machine Tools', 'requirements': ['Radio', 'Machine Tools'], 'flags': [], 'graphic': 'a.advanced_flight'},
    'alphabet': {'internal_id': 'alphabet', 'order': 2, 'name': 'Alphabet', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.alphabet'},
    'amphibious_warfare': {'internal_id': 'amphibious_warfare', 'order': 3, 'name': 'Amphibious Warfare', 'req1': 'Navigation', 'req2': 'Tactics', 'requirements': ['Navigation', 'Tactics'], 'flags': [], 'graphic': 'a.amphibious_warfare'},
    'astronomy': {'internal_id': 'astronomy', 'order': 4, 'name': 'Astronomy', 'req1': 'Mysticism', 'req2': 'Mathematics', 'requirements': ['Mysticism', 'Mathematics'], 'flags': [], 'graphic': 'a.astronomy'},
    'atomic_theory': {'internal_id': 'atomic_theory', 'order': 5, 'name': 'Atomic Theory', 'req1': 'Theory of Gravity', 'req2': 'Physics', 'requirements': ['Theory of Gravity', 'Physics'], 'flags': [], 'graphic': 'a.atomic_theory'},
    'automobile': {'internal_id': 'automobile', 'order': 6, 'name': 'Automobile', 'req1': 'Combustion', 'req2': 'Steel', 'requirements': ['Combustion', 'Steel'], 'flags': [], 'helptext': 'Increases the population\'s contribution to pollution.', 'graphic': 'a.automobile'},
    'banking': {'internal_id': 'banking', 'order': 7, 'name': 'Banking', 'req1': 'Trade', 'req2': 'The Republic', 'requirements': ['Trade', 'The Republic'], 'flags': [], 'graphic': 'a.banking'},
    'bridge_building': {'internal_id': 'bridge_building', 'order': 8, 'name': 'Bridge Building', 'req1': 'Iron Working', 'req2': 'Construction', 'requirements': ['Iron Working', 'Construction'], 'flags': ['Bridge'], 'helptext': 'Allows roads to be built on river tiles.', 'graphic': 'a.bridge_building'},
    'bronze_working': {'internal_id': 'bronze_working', 'order': 9, 'name': 'Bronze Working', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.bronze_working'},
    'ceremonial_burial': {'internal_id': 'ceremonial_burial', 'order': 10, 'name': 'Ceremonial Burial', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.ceremonial_burial'},
    'chemistry': {'internal_id': 'chemistry', 'order': 11, 'name': 'Chemistry', 'req1': 'University', 'req2': 'Medicine', 'requirements': ['University', 'Medicine'], 'flags': [], 'graphic': 'a.chemistry'},
    'chivalry': {'internal_id': 'chivalry', 'order': 12, 'name': 'Chivalry', 'req1': 'Feudalism', 'req2': 'Horseback Riding', 'requirements': ['Feudalism', 'Horseback Riding'], 'flags': [], 'graphic': 'a.chivalry'},
    'code_of_laws': {'internal_id': 'code_of_laws', 'order': 13, 'name': 'Code of Laws', 'req1': 'Alphabet', 'req2': 'None', 'requirements': ['Alphabet'], 'flags': [], 'graphic': 'a.code_of_laws'},
    'combined_arms': {'internal_id': 'combined_arms', 'order': 14, 'name': 'Combined Arms', 'req1': 'Mobile Warfare', 'req2': 'Advanced Flight', 'requirements': ['Mobile Warfare', 'Advanced Flight'], 'flags': [], 'graphic': 'a.combined_arms'},
    'combustion': {'internal_id': 'combustion', 'order': 15, 'name': 'Combustion', 'req1': 'Refining', 'req2': 'Explosives', 'requirements': ['Refining', 'Explosives'], 'flags': [], 'graphic': 'a.combustion'},
    'communism': {'internal_id': 'communism', 'order': 16, 'name': 'Communism', 'req1': 'Philosophy', 'req2': 'Industrialization', 'requirements': ['Philosophy', 'Industrialization'], 'flags': [], 'helptext': 'Reduces the effect of Cathedrals.', 'graphic': 'a.communism'},
    'computers': {'internal_id': 'computers', 'order': 17, 'name': 'Computers', 'req1': 'Mass Production', 'req2': 'Miniaturization', 'requirements': ['Mass Production', 'Miniaturization'], 'flags': [], 'graphic': 'a.computers'},
    'conscription': {'internal_id': 'conscription', 'order': 18, 'name': 'Conscription', 'req1': 'Democracy', 'req2': 'Metallurgy', 'requirements': ['Democracy', 'Metallurgy'], 'flags': [], 'graphic': 'a.conscription'},
    'construction': {'internal_id': 'construction', 'order': 19, 'name': 'Construction', 'req1': 'Masonry', 'req2': 'Currency', 'requirements': ['Masonry', 'Currency'], 'flags': [], 'helptext': 'Allows Settlers, Workers and Engineers to build fortresses, and to build oil wells on Desert tiles.', 'graphic': 'a.construction'},
    'currency': {'internal_id': 'currency', 'order': 20, 'name': 'Currency', 'req1': 'Bronze Working', 'req2': 'None', 'requirements': ['Bronze Working'], 'flags': [], 'graphic': 'a.currency'},
    'democracy': {'internal_id': 'democracy', 'order': 21, 'name': 'Democracy', 'req1': 'Banking', 'req2': 'Invention', 'requirements': ['Banking', 'Invention'], 'flags': [], 'graphic': 'a.democracy'},
    'economics': {'internal_id': 'economics', 'order': 22, 'name': 'Economics', 'req1': 'Banking', 'req2': 'University', 'requirements': ['Banking', 'University'], 'flags': [], 'graphic': 'a.economics'},
    'electricity': {'internal_id': 'electricity', 'order': 23, 'name': 'Electricity', 'req1': 'Metallurgy', 'req2': 'Magnetism', 'requirements': ['Metallurgy', 'Magnetism'], 'flags': [], 'helptext': 'Improves the effect of Colosseums.', 'graphic': 'a.electricity'},
    'electronics': {'internal_id': 'electronics', 'order': 24, 'name': 'Electronics', 'req1': 'The Corporation', 'req2': 'Electricity', 'requirements': ['The Corporation', 'Electricity'], 'flags': [], 'graphic': 'a.electronics'},
    'engineering': {'internal_id': 'engineering', 'order': 25, 'name': 'Engineering', 'req1': 'The Wheel', 'req2': 'Construction', 'requirements': ['The Wheel', 'Construction'], 'flags': [], 'graphic': 'a.engineering'},
    'environmentalism': {'internal_id': 'environmentalism', 'order': 26, 'name': 'Environmentalism', 'req1': 'Recycling', 'req2': 'Space Flight', 'requirements': ['Recycling', 'Space Flight'], 'flags': [], 'graphic': 'a.environmentalism'},
    'espionage': {'internal_id': 'espionage', 'order': 27, 'name': 'Espionage', 'req1': 'Communism', 'req2': 'Democracy', 'requirements': ['Communism', 'Democracy'], 'flags': [], 'graphic': 'a.espionage'},
    'explosives': {'internal_id': 'explosives', 'order': 28, 'name': 'Explosives', 'req1': 'Gunpowder', 'req2': 'Chemistry', 'requirements': ['Gunpowder', 'Chemistry'], 'flags': [], 'graphic': 'a.explosives'},
    'feudalism': {'internal_id': 'feudalism', 'order': 29, 'name': 'Feudalism', 'req1': 'Warrior Code', 'req2': 'Monarchy', 'requirements': ['Warrior Code', 'Monarchy'], 'flags': [], 'graphic': 'a.feudalism'},
    'flight': {'internal_id': 'flight', 'order': 30, 'name': 'Flight', 'req1': 'Combustion', 'req2': 'Theory of Gravity', 'requirements': ['Combustion', 'Theory of Gravity'], 'flags': ['Build_Airborne'], 'helptext': 'Decreases one-time revenue from new trade routes.', 'graphic': 'a.flight'},
    'fusion_power': {'internal_id': 'fusion_power', 'order': 31, 'name': 'Fusion Power', 'req1': 'Nuclear Power', 'req2': 'Superconductors', 'requirements': ['Nuclear Power', 'Superconductors'], 'flags': [], 'graphic': 'a.fusion_power'},
    'genetic_engineering': {'internal_id': 'genetic_engineering', 'order': 32, 'name': 'Genetic Engineering', 'req1': 'Medicine', 'req2': 'The Corporation', 'requirements': ['Medicine', 'The Corporation'], 'flags': [], 'graphic': 'a.genetic_engineering'},
    'guerilla_warfare': {'internal_id': 'guerilla_warfare', 'order': 33, 'name': 'Guerilla Warfare', 'req1': 'Communism', 'req2': 'Tactics', 'requirements': ['Communism', 'Tactics'], 'flags': [], 'graphic': 'a.guerilla_warfare'},
    'gunpowder': {'internal_id': 'gunpowder', 'order': 34, 'name': 'Gunpowder', 'req1': 'Invention', 'req2': 'Iron Working', 'requirements': ['Invention', 'Iron Working'], 'flags': [], 'graphic': 'a.gunpowder'},
    'horseback_riding': {'internal_id': 'horseback_riding', 'order': 35, 'name': 'Horseback Riding', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.horseback_riding'},
    'industrialization': {'internal_id': 'industrialization', 'order': 36, 'name': 'Industrialization', 'req1': 'Railroad', 'req2': 'Banking', 'requirements': ['Railroad', 'Banking'], 'flags': [], 'helptext': 'Population will start contributing to pollution.', 'graphic': 'a.industrialization'},
    'invention': {'internal_id': 'invention', 'order': 37, 'name': 'Invention', 'req1': 'Engineering', 'req2': 'Literacy', 'requirements': ['Engineering', 'Literacy'], 'flags': [], 'helptext': 'Increases units\' vision when in fortresses.', 'graphic': 'a.invention'},
    'iron_working': {'internal_id': 'iron_working', 'order': 38, 'name': 'Iron Working', 'req1': 'Bronze Working', 'req2': 'Warrior Code', 'requirements': ['Bronze Working', 'Warrior Code'], 'flags': [], 'graphic': 'a.iron_working'},
    'labor_union': {'internal_id': 'labor_union', 'order': 39, 'name': 'Labor Union', 'req1': 'Mass Production', 'req2': 'Guerilla Warfare', 'requirements': ['Mass Production', 'Guerilla Warfare'], 'flags': [], 'graphic': 'a.labor_union'},
    'laser': {'internal_id': 'laser', 'order': 40, 'name': 'Laser', 'req1': 'Mass Production', 'req2': 'Nuclear Power', 'requirements': ['Mass Production', 'Nuclear Power'], 'flags': [], 'graphic': 'a.laser'},
    'leadership': {'internal_id': 'leadership', 'order': 41, 'name': 'Leadership', 'req1': 'Chivalry', 'req2': 'Gunpowder', 'requirements': ['Chivalry', 'Gunpowder'], 'flags': [], 'graphic': 'a.leadership'},
    'literacy': {'internal_id': 'literacy', 'order': 42, 'name': 'Literacy', 'req1': 'Writing', 'req2': 'Code of Laws', 'requirements': ['Writing', 'Code of Laws'], 'flags': [], 'graphic': 'a.literacy'},
    'machine_tools': {'internal_id': 'machine_tools', 'order': 43, 'name': 'Machine Tools', 'req1': 'Steel', 'req2': 'Tactics', 'requirements': ['Steel', 'Tactics'], 'flags': [], 'graphic': 'a.machine_tools'},
    'magnetism': {'internal_id': 'magnetism', 'order': 44, 'name': 'Magnetism', 'req1': 'Iron Working', 'req2': 'Physics', 'requirements': ['Iron Working', 'Physics'], 'flags': [], 'helptext': 'Allows establishing one more trade route from each city.', 'graphic': 'a.magnetism'},
    'map_making': {'internal_id': 'map_making', 'order': 45, 'name': 'Map Making', 'req1': 'Alphabet', 'req2': 'None', 'requirements': ['Alphabet'], 'flags': [], 'graphic': 'a.map_making'},
    'masonry': {'internal_id': 'masonry', 'order': 46, 'name': 'Masonry', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.masonry'},
    'mass_production': {'internal_id': 'mass_production', 'order': 47, 'name': 'Mass Production', 'req1': 'Automobile', 'req2': 'The Corporation', 'requirements': ['Automobile', 'The Corporation'], 'flags': [], 'helptext': 'Increases the population\'s contribution to pollution.', 'graphic': 'a.mass_production'},
    'mathematics': {'internal_id': 'mathematics', 'order': 48, 'name': 'Mathematics', 'req1': 'Alphabet', 'req2': 'Masonry', 'requirements': ['Alphabet', 'Masonry'], 'flags': [], 'graphic': 'a.mathematics'},
    'medicine': {'internal_id': 'medicine', 'order': 49, 'name': 'Medicine', 'req1': 'Philosophy', 'req2': 'Trade', 'requirements': ['Philosophy', 'Trade'], 'flags': [], 'graphic': 'a.medicine'},
    'metallurgy': {'internal_id': 'metallurgy', 'order': 50, 'name': 'Metallurgy', 'req1': 'Gunpowder', 'req2': 'University', 'requirements': ['Gunpowder', 'University'], 'flags': [], 'graphic': 'a.metallurgy'},
    'miniaturization': {'internal_id': 'miniaturization', 'order': 51, 'name': 'Miniaturization', 'req1': 'Machine Tools', 'req2': 'Electronics', 'requirements': ['Machine Tools', 'Electronics'], 'flags': [], 'graphic': 'a.miniaturization'},
    'mobile_warfare': {'internal_id': 'mobile_warfare', 'order': 52, 'name': 'Mobile Warfare', 'req1': 'Automobile', 'req2': 'Tactics', 'requirements': ['Automobile', 'Tactics'], 'flags': [], 'graphic': 'a.mobile_warfare'},
    'monarchy': {'internal_id': 'monarchy', 'order': 53, 'name': 'Monarchy', 'req1': 'Ceremonial Burial', 'req2': 'Code of Laws', 'requirements': ['Ceremonial Burial', 'Code of Laws'], 'flags': [], 'graphic': 'a.monarchy'},
    'monotheism': {'internal_id': 'monotheism', 'order': 54, 'name': 'Monotheism', 'req1': 'Philosophy', 'req2': 'Polytheism', 'requirements': ['Philosophy', 'Polytheism'], 'flags': [], 'graphic': 'a.monotheism'},
    'mysticism': {'internal_id': 'mysticism', 'order': 55, 'name': 'Mysticism', 'req1': 'Ceremonial Burial', 'req2': 'None', 'requirements': ['Ceremonial Burial'], 'flags': [], 'helptext': 'Improves the effect of Temples.', 'graphic': 'a.mysticism'},
    'navigation': {'internal_id': 'navigation', 'order': 56, 'name': 'Navigation', 'req1': 'Seafaring', 'req2': 'Astronomy', 'requirements': ['Seafaring', 'Astronomy'], 'flags': [], 'graphic': 'a.navigation'},
    'nuclear_fission': {'internal_id': 'nuclear_fission', 'order': 57, 'name': 'Nuclear Fission', 'req1': 'Mass Production', 'req2': 'Atomic Theory', 'requirements': ['Mass Production', 'Atomic Theory'], 'flags': [], 'graphic': 'a.nuclear_fission'},
    'nuclear_power': {'internal_id': 'nuclear_power', 'order': 58, 'name': 'Nuclear Power', 'req1': 'Nuclear Fission', 'req2': 'Electronics', 'requirements': ['Nuclear Fission', 'Electronics'], 'flags': [], 'helptext': 'Gives sea units one extra move.', 'graphic': 'a.nuclear_power'},
    'philosophy': {'internal_id': 'philosophy', 'order': 59, 'name': 'Philosophy', 'req1': 'Mysticism', 'req2': 'Literacy', 'requirements': ['Mysticism', 'Literacy'], 'flags': ['Bonus_Tech'], 'bonus_message': 'Great philosophers from all the world join your civilization: you learn %s immediately.', 'graphic': 'a.philosophy'},
    'physics': {'internal_id': 'physics', 'order': 60, 'name': 'Physics', 'req1': 'Literacy', 'req2': 'Navigation', 'requirements': ['Literacy', 'Navigation'], 'flags': [], 'graphic': 'a.physics'},
    'plastics': {'internal_id': 'plastics', 'order': 61, 'name': 'Plastics', 'req1': 'Refining', 'req2': 'Space Flight', 'requirements': ['Refining', 'Space Flight'], 'flags': [], 'helptext': 'Increases the population\'s contribution to pollution.', 'graphic': 'a.plastics'},
    'polytheism': {'internal_id': 'polytheism', 'order': 62, 'name': 'Polytheism', 'req1': 'Horseback Riding', 'req2': 'Ceremonial Burial', 'requirements': ['Horseback Riding', 'Ceremonial Burial'], 'flags': [], 'graphic': 'a.polytheism'},
    'pottery': {'internal_id': 'pottery', 'order': 63, 'name': 'Pottery', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.pottery'},
    'radio': {'internal_id': 'radio', 'order': 64, 'name': 'Radio', 'req1': 'Flight', 'req2': 'Electricity', 'requirements': ['Flight', 'Electricity'], 'flags': [], 'helptext': 'Allows Workers and Engineers to build airbases and buoys.', 'graphic': 'a.radio'},
    'railroad': {'internal_id': 'railroad', 'order': 65, 'name': 'Railroad', 'req1': 'Steam Engine', 'req2': 'Bridge Building', 'requirements': ['Steam Engine', 'Bridge Building'], 'flags': [], 'helptext': 'Allows Settlers, Workers and Engineers to upgrade roads to railroads.', 'graphic': 'a.railroad'},
    'recycling': {'internal_id': 'recycling', 'order': 66, 'name': 'Recycling', 'req1': 'Mass Production', 'req2': 'Democracy', 'requirements': ['Mass Production', 'Democracy'], 'flags': [], 'graphic': 'a.recycling'},
    'refining': {'internal_id': 'refining', 'order': 67, 'name': 'Refining', 'req1': 'Chemistry', 'req2': 'The Corporation', 'requirements': ['Chemistry', 'The Corporation'], 'flags': [], 'helptext': 'Allows Settlers, Workers and Engineers to build oil wells on Glacier tiles.', 'graphic': 'a.refining'},
    'refrigeration': {'internal_id': 'refrigeration', 'order': 68, 'name': 'Refrigeration', 'req1': 'Sanitation', 'req2': 'Electricity', 'requirements': ['Sanitation', 'Electricity'], 'flags': [], 'helptext': 'Allows Settlers, Workers and Engineers to upgrade irrigation systems to farmland.', 'graphic': 'a.refrigeration'},
    'robotics': {'internal_id': 'robotics', 'order': 69, 'name': 'Robotics', 'req1': 'Mobile Warfare', 'req2': 'Computers', 'requirements': ['Mobile Warfare', 'Computers'], 'flags': [], 'graphic': 'a.robotics'},
    'rocketry': {'internal_id': 'rocketry', 'order': 70, 'name': 'Rocketry', 'req1': 'Advanced Flight', 'req2': 'Electronics', 'requirements': ['Advanced Flight', 'Electronics'], 'flags': [], 'graphic': 'a.rocketry'},
    'sanitation': {'internal_id': 'sanitation', 'order': 71, 'name': 'Sanitation', 'req1': 'Engineering', 'req2': 'Medicine', 'requirements': ['Engineering', 'Medicine'], 'flags': [], 'graphic': 'a.sanitation'},
    'seafaring': {'internal_id': 'seafaring', 'order': 72, 'name': 'Seafaring', 'req1': 'Pottery', 'req2': 'Map Making', 'requirements': ['Pottery', 'Map Making'], 'flags': [], 'graphic': 'a.seafaring'},
    'space_flight': {'internal_id': 'space_flight', 'order': 73, 'name': 'Space Flight', 'req1': 'Computers', 'req2': 'Rocketry', 'requirements': ['Computers', 'Rocketry'], 'flags': [], 'graphic': 'a.space_flight'},
    'stealth': {'internal_id': 'stealth', 'order': 74, 'name': 'Stealth', 'req1': 'Superconductors', 'req2': 'Advanced Flight', 'requirements': ['Superconductors', 'Advanced Flight'], 'flags': [], 'graphic': 'a.stealth'},
    'steam_engine': {'internal_id': 'steam_engine', 'order': 75, 'name': 'Steam Engine', 'req1': 'Physics', 'req2': 'Invention', 'requirements': ['Physics', 'Invention'], 'flags': [], 'graphic': 'a.steam_engine'},
    'steel': {'internal_id': 'steel', 'order': 76, 'name': 'Steel', 'req1': 'Electricity', 'req2': 'Industrialization', 'requirements': ['Electricity', 'Industrialization'], 'flags': [], 'graphic': 'a.steel'},
    'superconductors': {'internal_id': 'superconductors', 'order': 77, 'name': 'Superconductors', 'req1': 'Nuclear Power', 'req2': 'Laser', 'requirements': ['Nuclear Power', 'Laser'], 'flags': [], 'graphic': 'a.superconductors'},
    'tactics': {'internal_id': 'tactics', 'order': 78, 'name': 'Tactics', 'req1': 'Conscription', 'req2': 'Leadership', 'requirements': ['Conscription', 'Leadership'], 'flags': [], 'graphic': 'a.tactics'},
    'the_corporation': {'internal_id': 'the_corporation', 'order': 79, 'name': 'The Corporation', 'req1': 'Economics', 'req2': 'Industrialization', 'requirements': ['Economics', 'Industrialization'], 'flags': [], 'helptext': 'Allows establishing one more trade route from each city.', 'graphic': 'a.the_corporation'},
    'the_republic': {'internal_id': 'the_republic', 'order': 80, 'name': 'The Republic', 'req1': 'Code of Laws', 'req2': 'Literacy', 'requirements': ['Code of Laws', 'Literacy'], 'flags': [], 'graphic': 'a.the_republic'},
    'the_wheel': {'internal_id': 'the_wheel', 'order': 81, 'name': 'The Wheel', 'req1': 'Horseback Riding', 'req2': 'None', 'requirements': ['Horseback Riding'], 'flags': [], 'graphic': 'a.the_wheel'},
    'theology': {'internal_id': 'theology', 'order': 82, 'name': 'Theology', 'req1': 'Feudalism', 'req2': 'Monotheism', 'requirements': ['Feudalism', 'Monotheism'], 'flags': [], 'helptext': 'Improves the effect of Cathedrals.', 'graphic': 'a.theology'},
    'theory_of_gravity': {'internal_id': 'theory_of_gravity', 'order': 83, 'name': 'Theory of Gravity', 'req1': 'Astronomy', 'req2': 'University', 'requirements': ['Astronomy', 'University'], 'flags': [], 'graphic': 'a.theory_of_gravity'},
    'trade': {'internal_id': 'trade', 'order': 84, 'name': 'Trade', 'req1': 'Currency', 'req2': 'Code of Laws', 'requirements': ['Currency', 'Code of Laws'], 'flags': [], 'graphic': 'a.trade'},
    'university': {'internal_id': 'university', 'order': 85, 'name': 'University', 'req1': 'Mathematics', 'req2': 'Philosophy', 'requirements': ['Mathematics', 'Philosophy'], 'flags': [], 'graphic': 'a.university'},
    'warrior_code': {'internal_id': 'warrior_code', 'order': 86, 'name': 'Warrior Code', 'req1': 'None', 'req2': 'None', 'requirements': [], 'flags': [], 'graphic': 'a.warrior_code'},
    'writing': {'internal_id': 'writing', 'order': 87, 'name': 'Writing', 'req1': 'Alphabet', 'req2': 'None', 'requirements': ['Alphabet'], 'flags': [], 'graphic': 'a.writing'}
}

# Freeciv-web ID mapping
freeciv_web_id_mapping = {
    'Advanced Flight': 1, 'Alphabet': 2, 'Amphibious Warfare': 3, 'Astronomy': 4, 'Atomic Theory': 5,
    'Automobile': 6, 'Banking': 7, 'Bridge Building': 8, 'Bronze Working': 9, 'Ceremonial Burial': 10,
    'Chemistry': 11, 'Chivalry': 12, 'Code of Laws': 13, 'Combined Arms': 14, 'Combustion': 15,
    'Communism': 16, 'Computers': 17, 'Conscription': 18, 'Construction': 19, 'Currency': 20,
    'Democracy': 21, 'Economics': 22, 'Electricity': 23, 'Electronics': 24, 'Engineering': 25,
    'Environmentalism': 26, 'Espionage': 27, 'Explosives': 28, 'Feudalism': 29, 'Flight': 30,
    'Fusion Power': 31, 'Genetic Engineering': 32, 'Guerilla Warfare': 33, 'Gunpowder': 34, 'Horseback Riding': 35,
    'Industrialization': 36, 'Invention': 37, 'Iron Working': 38, 'Labor Union': 39, 'Laser': 40,
    'Leadership': 41, 'Literacy': 42, 'Machine Tools': 43, 'Magnetism': 44, 'Map Making': 45,
    'Masonry': 46, 'Mass Production': 47, 'Mathematics': 48, 'Medicine': 49, 'Metallurgy': 50,
    'Miniaturization': 51, 'Mobile Warfare': 52, 'Monarchy': 53, 'Monotheism': 54, 'Mysticism': 55,
    'Navigation': 56, 'Nuclear Fission': 57, 'Nuclear Power': 58, 'Philosophy': 59, 'Physics': 60,
    'Plastics': 61, 'Polytheism': 62, 'Pottery': 63, 'Radio': 64, 'Railroad': 65, 
    'Recycling': 66, 'Refining': 67, 'Refrigeration': 68, 'Robotics': 69, 'Rocketry': 70,
    'Sanitation': 71, 'Seafaring': 72, 'Space Flight': 73, 'Stealth': 74, 'Steam Engine': 75,
    'Steel': 76, 'Superconductors': 77, 'Tactics': 78, 'The Corporation': 79, 'The Republic': 80,
    'The Wheel': 81, 'Theology': 82, 'Theory of Gravity': 83, 'Trade': 84, 'University': 85,
    'Warrior Code': 86, 'Writing': 87
}

# Technology positioning from freeciv-web reqtree.js  
tech_positions = {
    'advanced_flight': {'x': 3479, 'y': 516},
    'alphabet': {'x': 0, 'y': 0},
    'amphibious_warfare': {'x': 2543, 'y': 616},
    'astronomy': {'x': 667, 'y': 290},
    'atomic_theory': {'x': 1753, 'y': 100},
    'automobile': {'x': 2977, 'y': 233},
    'banking': {'x': 1169, 'y': 6},
    'bridge_building': {'x': 918, 'y': 658},
    'bronze_working': {'x': 0, 'y': 534},
    'ceremonial_burial': {'x': 0, 'y': 69},
    'chemistry': {'x': 1420, 'y': 104},
    'chivalry': {'x': 1169, 'y': 605},
    'code_of_laws': {'x': 416, 'y': 79},
    'combined_arms': {'x': 3812, 'y': 539},
    'combustion': {'x': 2794, 'y': 185},
    'communism': {'x': 2271, 'y': 133},
    'computers': {'x': 3479, 'y': 346},
    'conscription': {'x': 1938, 'y': 508},
    'construction': {'x': 667, 'y': 500},
    'currency': {'x': 416, 'y': 532},
    'democracy': {'x': 1420, 'y': 133},
    'economics': {'x': 1420, 'y': 20},
    'electricity': {'x': 1938, 'y': 429},
    'electronics': {'x': 2543, 'y': 352},
    'engineering': {'x': 918, 'y': 425},
    'environmentalism': {'x': 4479, 'y': 196},
    'espionage': {'x': 2543, 'y': 172},
    'explosives': {'x': 1753, 'y': 238},
    'feudalism': {'x': 918, 'y': 504},
    'flight': {'x': 2977, 'y': 309},
    'fusion_power': {'x': 4680, 'y': 381},
    'genetic_engineering': {'x': 2543, 'y': 2},
    'guerilla_warfare': {'x': 2543, 'y': 428},
    'gunpowder': {'x': 1420, 'y': 612},
    'horseback_riding': {'x': 0, 'y': 417},
    'industrialization': {'x': 1938, 'y': 170},
    'invention': {'x': 1169, 'y': 386},
    'iron_working': {'x': 416, 'y': 635},
    'labor_union': {'x': 3479, 'y': 270},
    'laser': {'x': 4228, 'y': 378},
    'leadership': {'x': 1753, 'y': 620},
    'literacy': {'x': 667, 'y': 38},
    'machine_tools': {'x': 2543, 'y': 504},
    'magnetism': {'x': 1420, 'y': 458},
    'map_making': {'x': 416, 'y': 322},
    'masonry': {'x': 0, 'y': 300},
    'mass_production': {'x': 3228, 'y': 170},
    'mathematics': {'x': 416, 'y': 246},
    'medicine': {'x': 1169, 'y': 85},
    'metallurgy': {'x': 1753, 'y': 471},
    'miniaturization': {'x': 2892, 'y': 472},
    'mobile_warfare': {'x': 3228, 'y': 420},
    'monarchy': {'x': 667, 'y': 202},
    'monotheism': {'x': 1169, 'y': 310},
    'mysticism': {'x': 416, 'y': 167},
    'navigation': {'x': 918, 'y': 329},
    'nuclear_fission': {'x': 3479, 'y': 193},
    'nuclear_power': {'x': 3812, 'y': 298},
    'philosophy': {'x': 918, 'y': 152},
    'physics': {'x': 1169, 'y': 249},
    'plastics': {'x': 4479, 'y': 120},
    'polytheism': {'x': 416, 'y': 395},
    'pottery': {'x': 0, 'y': 183},
    'radio': {'x': 3228, 'y': 496},
    'railroad': {'x': 1753, 'y': 383},
    'recycling': {'x': 3479, 'y': 101},
    'refining': {'x': 2543, 'y': 93},
    'refrigeration': {'x': 2271, 'y': 491},
    'robotics': {'x': 3812, 'y': 384},
    'rocketry': {'x': 3812, 'y': 460},
    'sanitation': {'x': 1420, 'y': 384},
    'seafaring': {'x': 667, 'y': 369},
    'space_flight': {'x': 4228, 'y': 287},
    'stealth': {'x': 4680, 'y': 481},
    'steam_engine': {'x': 1420, 'y': 307},
    'steel': {'x': 2271, 'y': 300},
    'superconductors': {'x': 4479, 'y': 378},
    'tactics': {'x': 2271, 'y': 570},
    'the_corporation': {'x': 2271, 'y': 42},
    'the_republic': {'x': 918, 'y': 29},
    'the_wheel': {'x': 416, 'y': 456},
    'theology': {'x': 1420, 'y': 535},
    'theory_of_gravity': {'x': 1420, 'y': 210},
    'trade': {'x': 667, 'y': 126},
    'university': {'x': 1169, 'y': 173},
    'warrior_code': {'x': 0, 'y': 651},
    'writing': {'x': 416, 'y': 0}
}

def calculate_classic_cost(tech_id):
    '''Calculate freeciv classic cost: base_tech_cost * (1 + num_reqs) * sqrt(1 + num_reqs) / 2'''
    base_tech_cost = 20  # Standard freeciv base cost
    min_tech_cost = 10   # Minimum cost
    
    tech = techs_raw.get(tech_id)
    if not tech:
        return min_tech_cost
        
    num_direct_reqs = len(tech['requirements'])
    
    # Use direct requirements for cost calculation (this matches freeciv behavior better)
    cost = base_tech_cost * (1 + num_direct_reqs) * math.sqrt(1 + num_direct_reqs) / 2
    
    return max(int(cost), min_tech_cost)

# Build complete technology database
complete_tech_db = {}

for tech_id, tech_data in techs_raw.items():
    # Clean up the tech name for display
    display_name = tech_data['name']
    if display_name.startswith('?tech:'):
        display_name = display_name[6:]  # Remove ?tech: prefix
    
    # Build complete tech entry
    tech_entry = {
        'id': tech_id,
        'freeciv_id': freeciv_web_id_mapping.get(tech_data['name'], 0),
        'name': display_name,
        'internal_name': tech_data['name'],
        'cost': calculate_classic_cost(tech_id),
        'req1': tech_data.get('req1', 'None'),
        'req2': tech_data.get('req2', 'None'), 
        'requirements': tech_data.get('requirements', []),
        'root_req': tech_data.get('root_req'),
        'flags': tech_data.get('flags', []),
        'graphic': tech_data.get('graphic', ''),
        'position': tech_positions.get(tech_id, {'x': 0, 'y': 0}),
        'helptext': tech_data.get('helptext', ''),
        'bonus_message': tech_data.get('bonus_message', ''),
        'order': tech_data.get('order', 0)
    }
    
    complete_tech_db[tech_id] = tech_entry

# Output final results
print('COMPLETE FREECIV TECHNOLOGY DATABASE')
print('====================================')
print(f'Total Technologies: {len(complete_tech_db)}')

# Save to JSON file
with open('complete_freeciv_techs.json', 'w') as f:
    json.dump(complete_tech_db, f, indent=2)

print('Saved complete technology database to complete_freeciv_techs.json')