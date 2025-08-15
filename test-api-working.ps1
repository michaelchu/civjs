# PowerShell script to test the CivJS API endpoints
# This tests that the infinite recursion issue is fixed

Write-Host "Testing CivJS API endpoints..." -ForegroundColor Green
Write-Host ""

# Test 1: Health check
Write-Host "1. Testing health endpoint..."
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/health"
    Write-Host "✅ Health check successful: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 2: Get available games (this was the problematic endpoint)
Write-Host "2. Testing get available games..."
try {
    $games = Invoke-RestMethod -Uri "http://localhost:3001/api/games"
    Write-Host "✅ Get games successful! Found $($games.games.Count) games" -ForegroundColor Green
    Write-Host "   Response: $($games | ConvertTo-Json)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Get games failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 3: Try to create a game (this will likely fail due to RLS policies, but shouldn't cause infinite recursion)
Write-Host "3. Testing game creation (may fail due to RLS policies)..."
try {
    $gameData = @{
        name = "Test Game"
        settings = @{
            mapSize = "small"
            turnTimer = 300
            allowSpectators = $false
        }
    } | ConvertTo-Json -Depth 3

    $newGame = Invoke-RestMethod -Uri "http://localhost:3001/api/games" -Method Post -Body $gameData -ContentType "application/json"
    Write-Host "✅ Game creation successful!" -ForegroundColor Green
    Write-Host "   Game ID: $($newGame.game.id)" -ForegroundColor Gray
} catch {
    $errorMsg = $_.Exception.Message
    if ($errorMsg -like "*infinite recursion*") {
        Write-Host "❌ CRITICAL: Infinite recursion still occurring!" -ForegroundColor Red
    } elseif ($errorMsg -like "*foreign key*" -or $errorMsg -like "*row-level security*") {
        Write-Host "⚠️  Game creation failed due to auth/RLS policies (expected for testing)" -ForegroundColor Yellow
        Write-Host "   This is normal without proper user authentication setup" -ForegroundColor Gray
    } else {
        Write-Host "❌ Game creation failed: $errorMsg" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Test Summary:" -ForegroundColor Cyan
Write-Host "- If 'Get games' works, the infinite recursion issue is FIXED ✅" -ForegroundColor Green
Write-Host "- Game creation may fail due to missing user profiles (that's OK for now)" -ForegroundColor Yellow
