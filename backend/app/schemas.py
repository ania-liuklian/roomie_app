from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return str(value).lower()

    @field_validator("password")
    @classmethod
    def password_bytes(cls, value):
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must not exceed 72 UTF-8 bytes")
        return value


class Register(Credentials):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    color: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RoomCreate(BaseModel):
    number: str = Field(min_length=1, max_length=12)
    accent: str = Field(default="#7063df", pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("number")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Room number is required")
        return value.strip()
