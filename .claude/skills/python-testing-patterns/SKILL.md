---
name: python-testing-patterns
description: Comprehensive testing with pytest, fixtures, mocking (incl. subprocess), and property-based testing for robust Python applications. Use when writing or improving Python tests in this workspace.
---

# Python Testing Patterns

## Pytest Configuration

### pyproject.toml Setup
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py", "*_test.py"]
python_functions = ["test_*"]
asyncio_mode = "auto"
addopts = [
    "-v",
    "--strict-markers",
    "--cov=src",
    "--cov-report=term-missing",
    "--cov-fail-under=80"
]
markers = [
    "slow: marks tests as slow (deselect with '-m \"not slow\"')",
    "integration: marks tests as integration tests",
]
```

## Fixture Patterns

### Basic Fixtures
```python
import pytest
from typing import Iterator

@pytest.fixture
def sample_user() -> User:
    """Create a sample user for testing."""
    return User(name="Test User", email="test@example.com")

@pytest.fixture
def db_session() -> Iterator[Session]:
    """Provide a database session with rollback."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
```

### Async Fixtures
```python
import pytest_asyncio

@pytest_asyncio.fixture
async def async_client() -> AsyncIterator[AsyncClient]:
    """Provide async HTTP client."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client
```

### Factory Fixtures
```python
from typing import Callable

@pytest.fixture
def user_factory(db_session: Session) -> Callable[..., User]:
    """Factory fixture for creating users."""
    created_users = []

    def _create_user(**kwargs) -> User:
        defaults = {"name": "Test", "email": f"test{len(created_users)}@test.com"}
        defaults.update(kwargs)
        user = User(**defaults)
        db_session.add(user)
        db_session.flush()
        created_users.append(user)
        return user

    return _create_user
```

## Mocking Patterns

### Basic Mocking
```python
from unittest.mock import Mock, patch, AsyncMock

def test_service_calls_api(mocker):
    """Test that service calls external API."""
    mock_response = Mock()
    mock_response.json.return_value = {"status": "ok"}
    mocker.patch("module.requests.get", return_value=mock_response)

    result = service.fetch_data()
    assert result["status"] == "ok"

@pytest.mark.asyncio
async def test_async_service(mocker):
    """Test async service with AsyncMock."""
    mock_fetch = AsyncMock(return_value={"data": "test"})
    mocker.patch("module.fetch_external", mock_fetch)

    result = await service.process()
    assert result["data"] == "test"
```

### Context Manager Mocking
```python
def test_file_processing(mocker):
    """Test file processing with mocked file."""
    mock_file = mocker.mock_open(read_data="test content")
    mocker.patch("builtins.open", mock_file)

    result = process_file("dummy.txt")
    assert result == "processed: test content"
```

### Subprocess Mocking

For code that shells out to another process, mock the spawn so unit tests assert the exact argv (and exit-code handling) without running anything. This is the core pattern for testing a subprocess-driven bridge — verify the translated arguments, not the child.

```python
def test_builds_expected_argv(mocker):
    """Sync subprocess: assert the translated command line and exit-2 handling."""
    completed = mocker.Mock(returncode=2)  # partial failure exit code
    run = mocker.patch("subprocess.run", return_value=completed)

    extract(["https://example.com"], max_crawl_depth=3, headless=False)

    argv = run.call_args.args[0]
    assert "--max-crawl-depth" in argv and "3" in argv
    assert "--no-headless" in argv
    # exit 2 is partial success — the call must not raise

@pytest.mark.asyncio
async def test_async_subprocess(mocker):
    """Async subprocess: patch create_subprocess_exec with an AsyncMock proc."""
    proc = mocker.Mock()
    proc.communicate = AsyncMock(return_value=(b"", b""))
    proc.returncode = 0
    mocker.patch("asyncio.create_subprocess_exec", AsyncMock(return_value=proc))

    await aextract(["https://example.com"])
```

## Property-Based Testing

### Hypothesis Basics
```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1))
def test_string_processing(text: str):
    """Property: processed string should not be empty."""
    result = process_string(text)
    assert len(result) > 0

@given(st.lists(st.integers(), min_size=1))
def test_sort_preserves_length(numbers: list[int]):
    """Property: sorting preserves list length."""
    sorted_nums = sort_numbers(numbers)
    assert len(sorted_nums) == len(numbers)
```

## Test Organization

### conftest.py Structure
```python
# tests/conftest.py
import pytest
from typing import Iterator

@pytest.fixture(scope="session")
def app() -> FastAPI:
    """Create test application."""
    return create_app(testing=True)

@pytest.fixture(scope="function")
def client(app: FastAPI) -> Iterator[TestClient]:
    """Create test client."""
    with TestClient(app) as client:
        yield client
```

## Best Practices

- **Use fixtures for setup/teardown** — don't repeat setup code
- **Keep tests isolated** — each test should be independent
- **Use parametrize for variations** — `@pytest.mark.parametrize`
- **Test edge cases** — empty inputs, None values, boundary conditions
- **Mock external dependencies** — APIs, databases, file systems, subprocesses
- **Use property-based testing** — find edge cases automatically
- **Maintain high coverage** — aim for >80% coverage
- **Use meaningful assertions** — clear error messages
