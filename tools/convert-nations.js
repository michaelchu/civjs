#!/usr/bin/env node

/**
 * Freeciv Nation Ruleset to JSON Converter
 * 
 * Converts all freeciv nation .ruleset files to TypeScript-compatible JSON format
 * for use in CivJS. Maintains complete compatibility with freeciv nation system.
 * 
 * Usage: node tools/convert-nations.js
 * Output: apps/shared/src/data/nations.json
 */

const fs = require('fs');
const path = require('path');

// Configuration
const FREECIV_NATIONS_DIR = 'reference/freeciv/data/nation';
const NATIONLIST_FILE = 'reference/freeciv/data/default/nationlist.ruleset';
const OUTPUT_FILE = 'apps/shared/src/data/nations.json';
const OUTPUT_SETS_FILE = 'apps/shared/src/data/nation-sets.json';

class FreecivRulesetParser {
  constructor() {
    this.nations = [];
    this.nationSets = [];
    this.nationGroups = [];
  }

  /**
   * Parse a freeciv ruleset section like [nation_roman] or [nset_core]
   */
  parseRulesetFile(content, filename) {
    const sections = {};
    let currentSection = null;
    let currentKey = null;
    let currentValue = [];
    
    const lines = content.split('\n');
    
    for (let line of lines) {
      line = line.trim();
      
      // Skip comments and empty lines
      if (line.startsWith(';') || line.startsWith('#') || line === '') {
        continue;
      }
      
      // Section header like [nation_roman]
      if (line.startsWith('[') && line.endsWith(']')) {
        // Save previous key-value if exists
        if (currentSection && currentKey) {
          sections[currentSection][currentKey] = this.parseValue(currentValue.join('\n'));
        }
        
        currentSection = line.slice(1, -1);
        sections[currentSection] = {};
        currentKey = null;
        currentValue = [];
        continue;
      }
      
      // Key = value line
      if (line.includes('=') && currentSection) {
        // Save previous key-value if exists
        if (currentKey) {
          sections[currentSection][currentKey] = this.parseValue(currentValue.join('\n'));
        }
        
        const [key, ...valueParts] = line.split('=');
        currentKey = key.trim();
        currentValue = [valueParts.join('=').trim()];
        continue;
      }
      
      // Continuation line for multi-line values
      if (currentKey && line) {
        currentValue.push(line);
      }
    }
    
    // Save final key-value
    if (currentSection && currentKey) {
      sections[currentSection][currentKey] = this.parseValue(currentValue.join('\n'));
    }
    
    return sections;
  }

  /**
   * Parse and clean up freeciv values (remove translations, handle lists, etc.)
   */
  parseValue(value) {
    if (!value) return '';
    
    value = value.trim();
    
    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    // Handle translation strings like _("Roman") -> "Roman"
    value = value.replace(/_\("([^"]+)"\)/g, '$1');
    value = value.replace(/_\('([^']+)'\)/g, '$1');
    
    // Handle special translation markers like "?plural:Romans" -> "Romans"
    value = value.replace(/\?[^:]+:([^"']+)/g, '$1');
    
    // Handle multi-line strings with backslashes
    value = value.replace(/\\\s*\n\s*/g, ' ');
    value = value.replace(/\\\s*$/g, '');
    
    // Clean up whitespace
    value = value.replace(/\s+/g, ' ').trim();
    
    return value;
  }

  /**
   * Parse structured data like leaders table or cities list
   */
  parseStructuredData(value, type) {
    if (!value) return [];
    
    const lines = value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
    
    if (type === 'leaders') {
      const leaders = [];
      let inTable = false;
      
      for (const line of lines) {
        if (line.includes('"name"') && line.includes('"sex"')) {
          inTable = true;
          continue;
        }
        
        if (inTable && line.includes('"') && line.includes(',')) {
          const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
          if (parts.length >= 2) {
            leaders.push({
              name: parts[0],
              sex: parts[1]
            });
          }
        }
      }
      
      return leaders;
    }
    
    if (type === 'ruler_titles') {
      const titles = [];
      let inTable = false;
      
      for (const line of lines) {
        if (line.includes('"government"')) {
          inTable = true;
          continue;
        }
        
        if (inTable && line.includes('"') && line.includes(',')) {
          const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
          if (parts.length >= 3) {
            titles.push({
              government: parts[0],
              maleTitle: this.parseValue(parts[1]),
              femaleTitle: this.parseValue(parts[2])
            });
          }
        }
      }
      
      return titles;
    }
    
    if (type === 'cities') {
      return lines.map(line => {
        const cleanLine = line.replace(/"/g, '');
        const parts = cleanLine.split('(');
        const name = parts[0].trim();
        
        if (parts.length > 1) {
          const preferences = parts[1].replace(')', '').split(',').map(p => p.trim());
          return { name, terrainPreferences: preferences };
        }
        
        return { name };
      });
    }
    
    if (type === 'list') {
      return lines.flatMap(line => {
        return line.split(',').map(item => item.trim().replace(/"/g, ''));
      }).filter(item => item && item !== '-');
    }
    
    return [];
  }

  /**
   * Convert a freeciv nation section to our Nation interface
   */
  convertNation(nationData, nationId) {
    const nation = {
      id: nationId,
      translationDomain: nationData.translation_domain || 'freeciv-core',
      name: this.parseValue(nationData.name) || nationId,
      plural: this.parseValue(nationData.plural) || (this.parseValue(nationData.name) + 's'),
      groups: this.parseStructuredData(nationData.groups, 'list'),
      legend: this.parseValue(nationData.legend) || '',
      leaders: this.parseStructuredData(nationData.leaders, 'leaders'),
      rulerTitles: this.parseStructuredData(nationData.ruler_titles, 'ruler_titles'),
      flag: this.parseValue(nationData.flag) || nationId.toLowerCase(),
      flagAlt: this.parseValue(nationData.flag_alt) || undefined,
      style: this.parseValue(nationData.style) || 'European',
      initTechs: this.parseStructuredData(nationData.init_techs, 'list'),
      initBuildings: this.parseStructuredData(nationData.init_buildings, 'list'),
      initUnits: this.parseStructuredData(nationData.init_units, 'list'),
      cities: this.parseStructuredData(nationData.cities, 'cities'),
      civilwarNations: this.parseStructuredData(nationData.civilwar_nations, 'list'),
      conflictsWith: this.parseStructuredData(nationData.conflicts_with, 'list'),
      isPlayable: nationData.is_playable !== 'FALSE',
      barbarianType: nationData.barbarian_type ? this.parseValue(nationData.barbarian_type) : undefined
    };

    return nation;
  }

  /**
   * Parse the main nationlist.ruleset file for nation sets and groups
   */
  parseNationList() {
    console.log('📚 Parsing nation list and sets...');
    
    try {
      const content = fs.readFileSync(NATIONLIST_FILE, 'utf8');
      const sections = this.parseRulesetFile(content, 'nationlist.ruleset');
      
      // Parse nation sets
      for (const [sectionName, sectionData] of Object.entries(sections)) {
        if (sectionName.startsWith('nset_')) {
          this.nationSets.push({
            name: this.parseValue(sectionData.name),
            ruleName: this.parseValue(sectionData.rule_name),
            description: this.parseValue(sectionData.description),
            nations: [] // Will be populated later
          });
        }
        
        if (sectionName.startsWith('ngroup_')) {
          this.nationGroups.push({
            name: this.parseValue(sectionData.name),
            hidden: sectionData.hidden === 'TRUE' || sectionData.hidden === 'true',
            match: parseInt(sectionData.match) || 0,
            nations: [] // Will be populated later
          });
        }
      }
      
      console.log(`✅ Found ${this.nationSets.length} nation sets and ${this.nationGroups.length} nation groups`);
    } catch (error) {
      console.error('❌ Error parsing nationlist:', error.message);
    }
  }

  /**
   * Convert all nation ruleset files
   */
  async convertAllNations() {
    console.log('🌍 Converting all freeciv nations...');
    
    if (!fs.existsSync(FREECIV_NATIONS_DIR)) {
      console.error(`❌ Freeciv nations directory not found: ${FREECIV_NATIONS_DIR}`);
      return;
    }

    const files = fs.readdirSync(FREECIV_NATIONS_DIR);
    const rulesetFiles = files.filter(f => f.endsWith('.ruleset'));
    
    console.log(`📁 Found ${rulesetFiles.length} nation ruleset files`);
    
    let converted = 0;
    let errors = 0;

    for (const filename of rulesetFiles) {
      try {
        const filepath = path.join(FREECIV_NATIONS_DIR, filename);
        const content = fs.readFileSync(filepath, 'utf8');
        const sections = this.parseRulesetFile(content, filename);
        
        // Find the nation section (usually the first one starting with 'nation_')
        const nationSection = Object.keys(sections).find(key => key.startsWith('nation_'));
        
        if (nationSection && sections[nationSection]) {
          const nationId = nationSection.replace('nation_', '');
          const nation = this.convertNation(sections[nationSection], nationId);
          this.nations.push(nation);
          converted++;
          
          if (converted % 50 === 0) {
            console.log(`⚡ Converted ${converted} nations...`);
          }
        } else {
          console.warn(`⚠️  No nation section found in ${filename}`);
        }
      } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error.message);
        errors++;
      }
    }

    console.log(`✅ Successfully converted ${converted} nations (${errors} errors)`);
    return { converted, errors };
  }

  /**
   * Assign nations to sets and groups based on their properties
   */
  populateSetsMembership() {
    console.log('🏷️  Populating nation sets and groups...');
    
    // Assign nations to groups based on their 'groups' property
    for (const nation of this.nations) {
      for (const groupName of nation.groups) {
        const group = this.nationGroups.find(g => 
          g.name.toLowerCase().includes(groupName.toLowerCase()) ||
          groupName.toLowerCase().includes(g.name.toLowerCase())
        );
        
        if (group && !group.nations.includes(nation.id)) {
          group.nations.push(nation.id);
        }
      }
    }
    
    // Assign nations to sets
    const coreSet = this.nationSets.find(s => s.ruleName === 'core');
    const allSet = this.nationSets.find(s => s.ruleName === 'all');
    
    // Core nations (those with 'Core' group)
    const coreNations = this.nations.filter(n => n.groups.includes('Core'));
    if (coreSet) {
      coreSet.nations = coreNations.map(n => n.id);
    }
    
    // All set gets all playable nations
    if (allSet) {
      allSet.nations = this.nations.filter(n => n.isPlayable).map(n => n.id);
    }
    
    console.log(`✅ Core set: ${coreSet?.nations.length || 0} nations`);
    console.log(`✅ All set: ${allSet?.nations.length || 0} nations`);
  }

  /**
   * Save the converted data to JSON files
   */
  saveData() {
    console.log('💾 Saving converted data...');
    
    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save nations data
    const nationsData = {
      metadata: {
        convertedAt: new Date().toISOString(),
        totalNations: this.nations.length,
        playableNations: this.nations.filter(n => n.isPlayable).length,
        source: 'freeciv reference rulesets'
      },
      nations: this.nations.reduce((acc, nation) => {
        acc[nation.id] = nation;
        return acc;
      }, {})
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(nationsData, null, 2));
    
    // Save sets and groups data
    const setsData = {
      sets: this.nationSets,
      groups: this.nationGroups
    };
    
    fs.writeFileSync(OUTPUT_SETS_FILE, JSON.stringify(setsData, null, 2));
    
    console.log(`✅ Saved ${this.nations.length} nations to ${OUTPUT_FILE}`);
    console.log(`✅ Saved ${this.nationSets.length} sets and ${this.nationGroups.length} groups to ${OUTPUT_SETS_FILE}`);
  }

  /**
   * Main conversion process
   */
  async run() {
    console.log('🚀 Starting freeciv nation conversion...');
    
    try {
      // Parse nation sets and groups from nationlist
      this.parseNationList();
      
      // Convert all individual nation files
      const result = await this.convertAllNations();
      
      if (result.converted === 0) {
        console.error('❌ No nations were converted successfully');
        return;
      }
      
      // Populate set memberships
      this.populateSetsMembership();
      
      // Save to JSON files
      this.saveData();
      
      console.log('🎉 Conversion completed successfully!');
      console.log(`📊 Statistics:`);
      console.log(`   • Total nations: ${this.nations.length}`);
      console.log(`   • Playable nations: ${this.nations.filter(n => n.isPlayable).length}`);
      console.log(`   • Barbarian nations: ${this.nations.filter(n => n.barbarianType).length}`);
      console.log(`   • Nation sets: ${this.nationSets.length}`);
      console.log(`   • Nation groups: ${this.nationGroups.length}`);
      
    } catch (error) {
      console.error('❌ Conversion failed:', error.message);
      console.error(error.stack);
    }
  }
}

// Run the converter
if (require.main === module) {
  const converter = new FreecivRulesetParser();
  converter.run();
}

module.exports = FreecivRulesetParser;