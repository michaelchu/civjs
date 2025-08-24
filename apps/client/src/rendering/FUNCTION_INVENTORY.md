# Complete Function Inventory for Rendering Port

## Status: MAJOR GAPS IDENTIFIED 
**We only have ~6 functions ported out of 70+ total functions that need to be converted!**

## tilespec.js Functions (53 total) - STATUS: 2/53 ✅

### ✅ DONE (2 functions):
1. `tileset_has_tag(tagname)` ✅  
2. `fill_sprite_array(layer, ptile, pedge, pcorner, punit, pcity, citymode)` ✅ (stub only)

### ❌ MISSING (51 functions):

#### Core Sprite Selection Functions:
3. `tileset_ruleset_entity_tag_str_or_alt(entity, kind_name)`
4. `tileset_extra_graphic_tag(extra)`
5. `tileset_unit_type_graphic_tag(utype)`
6. `tileset_unit_graphic_tag(punit)`
7. `tileset_building_graphic_tag(pimprovement)`
8. `tileset_tech_graphic_tag(ptech)`
9. `tileset_extra_id_graphic_tag(extra_id)`
10. `tileset_extra_activity_graphic_tag(extra)`
11. `tileset_extra_id_activity_graphic_tag(extra_id)`
12. `tileset_extra_rmactivity_graphic_tag(extra)`
13. `tileset_extra_id_rmactivity_graphic_tag(extra_id)`

#### Terrain Rendering Functions:
14. `fill_terrain_sprite_layer(layer_num, ptile, pterrain, tterrain_near)`
15. `fill_terrain_sprite_array(l, ptile, pterrain, tterrain_near)`
16. `check_sprite_type(sprite_type)`

#### Unit Rendering Functions:
17. `fill_unit_sprite_array(punit, stacked, backdrop)` ⚠️ CRITICAL
18. `get_unit_nation_flag_sprite(punit)`
19. `get_unit_nation_flag_normal_sprite(punit)`
20. `get_unit_stack_sprite(punit)`
21. `get_unit_hp_sprite(punit)`
22. `get_unit_veteran_sprite(punit)`
23. `get_unit_activity_sprite(punit)`
24. `get_unit_agent_sprite(punit)`
25. `get_unit_image_sprite(punit)`
26. `get_unit_type_image_sprite(punittype)`

#### City Rendering Functions:
27. `get_city_flag_sprite(pcity)`
28. `get_city_occupied_sprite(pcity)`
29. `get_city_food_output_sprite(num)`
30. `get_city_shields_output_sprite(num)`
31. `get_city_trade_output_sprite(num)`
32. `get_city_invalid_worked_sprite()`
33. `get_city_sprite(pcity)` ⚠️ CRITICAL
34. `get_city_info_text(pcity)`

#### Fog & Visibility Functions:
35. `fill_fog_sprite_array(ptile, pedge, pcorner)` ⚠️ CRITICAL

#### Special Layers Functions:
36. `fill_layer1_sprite_array(ptile, pcity)`
37. `fill_layer2_sprite_array(ptile, pcity)`  
38. `fill_layer3_sprite_array(ptile, pcity)`

#### Path & Border Functions:
39. `fill_goto_line_sprite_array(ptile)`
40. `get_border_line_sprites(ptile)`
41. `fill_path_sprite_array(ptile, pcity)`

#### Utilities & UI Functions:
42. `dir_get_tileset_name(dir)`
43. `cardinal_index_str(idx)`
44. `get_base_flag_sprite(ptile)`
45. `get_select_sprite()`
46. `get_tile_label_text(ptile)`
47. `get_tile_specials_sprite(ptile)`
48. `get_tile_river_sprite(ptile)`

#### Infrastructure Functions:
49. `fill_irrigation_sprite_array(ptile, pcity)`

#### Image & UI Functions:
50. `get_improvement_image_sprite(pimprovement)`
51. `get_specialist_image_sprite(tag)`
52. `get_technology_image_sprite(ptech)`
53. `get_nation_flag_sprite(pnation)`
54. `get_treaty_agree_thumb_up()`
55. `get_treaty_disagree_thumb_down()`

#### Color Management:
56. `assign_nation_color(nation_id)`
57. `is_color_collision(color_a, color_b)`
58. `color_rbg_to_list(pcolor)`

## mapview.js Functions (17 total) - STATUS: 4/17 ✅

### ✅ DONE (4 functions):
1. `init_mapview()` ✅ (stub only)
2. `preload_check()` ✅ (stub only)  
3. `mapview_put_tile(pcanvas, tag, canvas_x, canvas_y)` ✅ (stub only)
4. `canvas_put_rectangle(...)` ✅

### ❌ MISSING (13 functions):

#### Core Initialization:
5. `is_small_screen()`
6. `init_sprites()` ⚠️ CRITICAL
7. `init_cache_sprites()` ⚠️ CRITICAL
8. `mapview_window_resized()`

#### Canvas Drawing Functions:
9. `drawPath(ctx, x1, y1, x2, y2, x3, y3, x4, y4)`
10. `canvas_put_select_rectangle(canvas_context, canvas_x, canvas_y, width, height)`
11. `mapview_put_city_bar(pcanvas, city, canvas_x, canvas_y)` ⚠️ CRITICAL
12. `mapview_put_tile_label(pcanvas, tile, canvas_x, canvas_y)` ⚠️ CRITICAL
13. `mapview_put_border_line(pcanvas, dir, color, canvas_x, canvas_y)`
14. `mapview_put_goto_line(pcanvas, dir, canvas_x, canvas_y)`

#### View Management:
15. `set_city_mapview_active()`
16. `set_default_mapview_inactive()`
17. `enable_mapview_slide(ptile)`

## CRITICAL ASSESSMENT:

### 🚨 **MAJOR ISSUE**: Only ~8% Complete
- **Total Functions Needed**: ~70
- **Actually Ported**: ~6  
- **Completion Rate**: 8.5%

### ⚠️ **Most Critical Missing Functions**:
1. `fill_sprite_array()` - Only stub, needs full 13-layer implementation
2. `init_sprites()` - Essential for sprite loading
3. `fill_unit_sprite_array()` - Core unit rendering
4. `get_city_sprite()` - Core city rendering  
5. `fill_fog_sprite_array()` - Fog of war system
6. `mapview_put_city_bar()` - City information display

### 📋 **Next Steps Required**:
1. **Priority 1**: Complete the 13-layer `fill_sprite_array()` implementation
2. **Priority 2**: Port all core rendering functions (units, cities, terrain)
3. **Priority 3**: Port canvas management and sprite loading
4. **Priority 4**: Port utility and UI functions