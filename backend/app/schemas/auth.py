from pydantic import BaseModel, Field, field_validator


class AuthInput(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
            raise ValueError("Enter a valid email address.")
        return email


class UserResponse(BaseModel):
    id: int
    email: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CurrentUserResponse(BaseModel):
    id: int
    email: str
    is_demo: bool
