cmake_minimum_required(VERSION 3.16)
project(emilia_native_tools LANGUAGES CXX)

add_executable(workspace-search workspace_search.cpp)
target_compile_features(workspace-search PRIVATE cxx_std_17)
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(workspace-search PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
